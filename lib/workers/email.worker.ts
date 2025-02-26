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
      console.log('\n[EMAIL WORKER] ====== Starting email processing cycle ======');
      console.log(`[EMAIL WORKER] Time: ${new Date().toISOString()}`);
      console.log('[EMAIL WORKER] Step 1: Connecting to IMAP server...');
      
      await this.processor.connect();
      console.log('[EMAIL WORKER] ✓ Connected to IMAP server');
      
      console.log('[EMAIL WORKER] Step 2: Downloading new emails...');
      const downloadResult = await this.processor.processEmails();
      console.log(`[EMAIL WORKER] ✓ Downloaded ${downloadResult?.processed || 0} new emails`);
      if (downloadResult?.errors > 0) {
        console.warn(`[EMAIL WORKER] ⚠ Encountered ${downloadResult.errors} errors during download`);
      }
      
      console.log('[EMAIL WORKER] Step 3: Disconnecting from IMAP...');
      await this.processor.disconnect();
      console.log('[EMAIL WORKER] ✓ Disconnected from IMAP server');

      // Step 2: Flow'a Gönderilmemiş Emailleri İşleme
      console.log('\n[EMAIL WORKER] Step 4: Processing unsent emails to Flow...');
      console.log('[EMAIL WORKER] Connecting to database...');
      client = await pool.connect();
      console.log('[EMAIL WORKER] ✓ Connected to database');

      // Transaction başlat
      console.log('[EMAIL WORKER] Starting database transaction...');
      await client.query('BEGIN');

      try {
        // Gönderilmemiş emailleri al
        console.log('[EMAIL WORKER] Fetching unsent emails...');
        const result = await client.query(`
          SELECT * FROM emails 
          WHERE senttoflow = false 
          ORDER BY received_date ASC
          LIMIT 50
        `);

        console.log(`[EMAIL WORKER] Found ${result.rows.length} emails to send to Flow`);

        let successCount = 0;
        let errorCount = 0;

        for (const email of result.rows) {
          try {
            // Flow'a gönder
            console.log(`[EMAIL WORKER] Processing email ID: ${email.id} (Subject: ${email.subject})`);
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

              console.log(`[EMAIL WORKER] ✓ Successfully processed email ID: ${email.id}`);
              console.log(`[EMAIL WORKER]   Flow ID: ${flowResponse.flowId}`);
              successCount++;
            } else {
              console.error(`[EMAIL WORKER] ✗ Flow error for email ID ${email.id}:`, flowResponse.error);
              errorCount++;
              throw new Error(`Flow service error: ${flowResponse.error}`);
            }
          } catch (emailError) {
            console.error(`[EMAIL WORKER] ✗ Error processing email ID ${email.id}:`, emailError);
            errorCount++;
            // Her email için ayrı hata yönetimi - diğer emaillerin işlenmesini engellemez
            continue;
          }
        }

        // Transaction'ı commit et
        console.log('\n[EMAIL WORKER] Committing database transaction...');
        await client.query('COMMIT');
        console.log('[EMAIL WORKER] ✓ Successfully committed all changes');

        const duration = Date.now() - startTime;
        console.log('\n[EMAIL WORKER] ====== Email processing summary ======');
        console.log(`[EMAIL WORKER] Total processing time: ${duration}ms`);
        console.log(`[EMAIL WORKER] Emails processed: ${result.rows.length}`);
        console.log(`[EMAIL WORKER] Success: ${successCount}`);
        console.log(`[EMAIL WORKER] Errors: ${errorCount}`);
        console.log('[EMAIL WORKER] ======================================\n');
      
        return { 
          success: true, 
          details: `Processed ${result.rows.length} emails (${successCount} success, ${errorCount} errors) in ${duration}ms` 
        };

      } catch (txError) {
        // Transaction hatası durumunda rollback
        console.error('[EMAIL WORKER] ✗ Transaction error, rolling back...', txError);
        await client.query('ROLLBACK');
        throw txError;
      }

    } catch (error) {
      console.error('[EMAIL WORKER] ✗ Critical error:', error);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
          console.log('[EMAIL WORKER] ✓ Successfully rolled back transaction');
        } catch (rollbackError) {
          console.error('[EMAIL WORKER] ✗ Rollback error:', rollbackError);
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
        console.log('[EMAIL WORKER] ✓ Database connection released');
      }

      try {
        await this.processor.disconnect();
        console.log('[EMAIL WORKER] ✓ IMAP connection closed');
      } catch (disconnectError) {
        console.error('[EMAIL WORKER] ✗ Error disconnecting from IMAP:', disconnectError);
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
