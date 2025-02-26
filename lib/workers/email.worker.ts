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

    try {
      // Step 1: IMAP Bağlantısı ve Email İndirme
      console.log('\n[WORKER] ====== Starting email processing ======');
      console.log(`[WORKER] Time: ${new Date().toISOString()}`);
      console.log('[WORKER] Mode: Worker Mode (WORKER_MODE=1)');
      console.log(`[WORKER] ✓ Attachments directory ready: ${process.env.ATTACHMENTS_DIR || '/var/www/flowgit/public/attachments'}\n`);

      console.log('[WORKER] Step 1: Checking for new emails...');
      console.log('[WORKER] Initializing IMAP connection...');
      
      await this.processor.connect();
      console.log('[WORKER] ✓ IMAP connection established\n');
      
      console.log('[WORKER] Step 2: Processing IMAP mailbox...');
      const downloadResult = await this.processor.processEmails();
      
      if (downloadResult.processed === 0) {
        console.log('[WORKER] No new emails to process');
      } else {
        console.log(`[WORKER] ✓ Processed ${downloadResult.processed} emails`);
        if (downloadResult.errors > 0) {
          console.warn(`[WORKER] ⚠ Encountered ${downloadResult.errors} errors during processing`);
        }
      }

      console.log('\n[WORKER] Step 3: Checking for unsent Flow emails...');
      console.log('[WORKER] Connecting to database...');
      client = await pool.connect();
      console.log('[WORKER] ✓ Connected to database');

      // Transaction başlat
      console.log('[WORKER] Starting database transaction...');
      await client.query('BEGIN');

      try {
        // Gönderilmemiş emailleri al
        console.log('[WORKER] Fetching unsent emails...');
        const result = await client.query(`
          SELECT * FROM emails 
          WHERE senttoflow = false 
          ORDER BY received_date ASC
          LIMIT 50
        `);

        console.log(`[WORKER] Found ${result.rows.length} emails to send to Flow`);

        let successCount = 0;
        let errorCount = 0;

        for (const email of result.rows) {
          try {
            // Flow'a gönder
            console.log(`[WORKER] Processing email ID: ${email.id} (Subject: ${email.subject})`);
            const flowResponse = await FlowService.sendToFlow(email);

            if (flowResponse.success) {
              // Flow ID'yi subject'e ekle ve database'i güncelle
              const updatedSubject = `${email.subject} [FlowID: ${flowResponse.flowId}]`;
              await client.query(`
                UPDATE emails 
                SET senttoflow = true,
                    subject = $1,
                    processed_date = CURRENT_TIMESTAMP
                WHERE id = $2
              `, [updatedSubject, email.id]);

              console.log(`[WORKER] ✓ Successfully processed email ID: ${email.id}`);
              console.log(`[WORKER]   Flow ID: ${flowResponse.flowId}`);
              successCount++;
            } else {
              console.error(`[WORKER] ✗ Flow error for email ID ${email.id}:`, flowResponse.error);
              errorCount++;
              throw new Error(`Flow service error: ${flowResponse.error}`);
            }
          } catch (emailError) {
            console.error(`[WORKER] ✗ Error processing email ID ${email.id}:`, emailError);
            errorCount++;
            // Her email için ayrı hata yönetimi - diğer emaillerin işlenmesini engellemez
            continue;
          }
        }

        // Transaction'ı commit et
        console.log('\n[WORKER] Committing database transaction...');
        await client.query('COMMIT');
        console.log('[WORKER] ✓ Successfully committed all changes');

        const duration = Date.now() - startTime;
        console.log('\n[WORKER] ====== Email processing summary ======');
        console.log(`[WORKER] Total processing time: ${duration}ms`);
        console.log(`[WORKER] Emails processed: ${result.rows.length}`);
        console.log(`[WORKER] Success: ${successCount}`);
        console.log(`[WORKER] Errors: ${errorCount}`);
        console.log('[WORKER] ======================================\n');
      
        return { 
          success: true, 
          details: `Processed ${result.rows.length} emails (${successCount} success, ${errorCount} errors) in ${duration}ms` 
        };

      } catch (txError) {
        // Transaction hatası durumunda rollback
        console.error('[WORKER] ✗ Transaction error, rolling back...', txError);
        await client.query('ROLLBACK');
        throw txError;
      }

    } catch (error) {
      console.error('[WORKER] ✗ Critical error:', error);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
          console.log('[WORKER] ✓ Successfully rolled back transaction');
        } catch (rollbackError) {
          console.error('[WORKER] ✗ Rollback error:', rollbackError);
        }
      }

      return { 
        success: false, 
        error: error.message 
      };

    } finally {
      this.isProcessing = false;
      
      if (client) {
        client.release();
        console.log('[WORKER] ✓ Database connection released');
      }

      try {
        await this.processor.disconnect();
        console.log('[WORKER] ✓ IMAP connection closed');
      } catch (disconnectError) {
        console.error('[WORKER] ✗ Error disconnecting from IMAP:', disconnectError);
      }
    }
  }
}

// Worker thread message handler
parentPort?.on('message', async (message) => {
  if (message === 'start') {
    const worker = new EmailWorker();
    const result = await worker.processEmails();
    parentPort?.postMessage(result);
  }
});
