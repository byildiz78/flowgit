import { parentPort } from 'worker_threads';
import { EmailProcessor } from '../processors/imap.processor';
import pool from '../db';
import { FlowService } from '../services/flow.service';

export class EmailWorker {
  private processor: EmailProcessor;
  private isProcessing: boolean = false;

  constructor() {
    this.processor = new EmailProcessor();
  }

  async processEmails(): Promise<{ success: boolean; error?: string; details?: string }> {
    if (this.isProcessing) {
      console.log('[EMAIL WORKER] Already processing emails, skipping...');
      return { success: false, error: 'Already processing emails' };
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let client = null;
    let totalProcessed = 0;
    let errorCount = 0;

    try {
      console.log('\n[EMAIL WORKER] Starting email processor...');
      
      // IMAP sunucusuna bağlan
      console.log('[EMAIL WORKER] Step 1: Connecting to IMAP server...');
      await this.processor.connect();
      console.log('[EMAIL WORKER] ✓ Connected to IMAP server');

      // Database bağlantısı
      console.log('\n[EMAIL WORKER] Step 2: Connecting to database...');
      client = await pool.connect();
      console.log('[EMAIL WORKER] ✓ Connected to database');

      // Mailleri işle
      console.log('\n[EMAIL WORKER] Step 3: Processing emails...');
      const result = await this.processor.processEmails();
      
      if (result && typeof result === 'object') {
        totalProcessed = result.processed || 0;
        errorCount = result.errors || 0;
        
        console.log(`[EMAIL WORKER] ✓ Processed ${totalProcessed} emails`);
        if (errorCount > 0) {
          console.warn(`[EMAIL WORKER] ⚠ Encountered ${errorCount} errors during processing`);
        }
      }

      // Get unprocessed emails that need to be sent to Flow
      const result = await client.query(`
        SELECT e.* 
        FROM emails e 
        LEFT JOIN email_flow_locks l ON e.id = l.email_id 
        WHERE e.senttoflow = false 
        AND (l.locked_until IS NULL OR l.locked_until < NOW())
        LIMIT 10
      `);

      for (const email of result.rows) {
        // Try to acquire lock
        const lockResult = await client.query(`
          INSERT INTO email_flow_locks (email_id, locked_until)
          VALUES ($1, NOW() + INTERVAL '5 minutes')
          ON CONFLICT (email_id) 
          DO UPDATE SET locked_until = NOW() + INTERVAL '5 minutes'
          WHERE email_flow_locks.locked_until < NOW()
          RETURNING *
        `, [email.id]);

        // If we got the lock, process the email
        if (lockResult.rows.length > 0) {
          try {
            await FlowService.sendToFlow(client, email.id, email);
            // Release lock after successful processing
            await client.query('DELETE FROM email_flow_locks WHERE email_id = $1', [email.id]);
          } catch (error) {
            console.error(`[WORKER] Error sending email ${email.id} to Flow:`, error);
            // Release lock on error
            await client.query('DELETE FROM email_flow_locks WHERE email_id = $1', [email.id]);
          }
        }
      }

      // Bağlantıları kapat
      console.log('\n[EMAIL WORKER] Step 4: Cleaning up connections...');
      
      if (client) {
        client.release();
        console.log('[EMAIL WORKER] ✓ Database connection released');
      }
      
      await this.processor.disconnect();
      console.log('[EMAIL WORKER] ✓ Disconnected from IMAP server');

      const duration = Date.now() - startTime;
      console.log(`\n[EMAIL WORKER] Total processing time: ${duration}ms`);

      return {
        success: true,
        details: `Processed ${totalProcessed} emails${errorCount > 0 ? `, with ${errorCount} errors` : ''} in ${duration}ms`
      };

    } catch (error) {
      console.error('[EMAIL WORKER] ✗ Email processing failed:', error);
      
      // Hata durumunda bağlantıları temizle
      try {
        if (client) {
          client.release();
          console.log('[EMAIL WORKER] ✓ Database connection released after error');
        }
        
        await this.processor.disconnect();
        console.log('[EMAIL WORKER] ✓ Disconnected from IMAP server after error');
      } catch (cleanupError) {
        console.error('[EMAIL WORKER] ✗ Failed to cleanup connections:', cleanupError);
      }

      return {
        success: false,
        error: error.message,
        details: `Failed after processing ${totalProcessed} emails${errorCount > 0 ? `, with ${errorCount} errors` : ''}`
      };
    } finally {
      this.isProcessing = false;
    }
  }
}

// Listen for messages from the main thread
parentPort?.on('message', async (message) => {
  if (message === 'start') {
    const worker = new EmailWorker();
    const result = await worker.processEmails();
    parentPort?.postMessage(result);
  }
});

// Handle cleanup
process.on('SIGTERM', async () => {
  process.exit(0);
});
