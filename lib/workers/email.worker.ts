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
      console.log('\n[EMAIL WORKER] Step 1: Processing new emails from IMAP...');
      await this.processor.connect();
      const downloadResult = await this.processor.processEmails();
      console.log(`[EMAIL WORKER] ✓ Downloaded ${downloadResult?.processed || 0} new emails`);
      await this.processor.disconnect();

      // Step 2: Flow'a Gönderilmemiş Emailleri İşleme
      console.log('\n[EMAIL WORKER] Step 2: Processing unsent emails to Flow...');
      client = await pool.connect();

      // Transaction başlat
      await client.query('BEGIN');

      try {
        // Gönderilmemiş emailleri al
        const result = await client.query(`
          SELECT * FROM emails 
          WHERE senttoflow = false 
          ORDER BY received_date ASC
          LIMIT 50
        `);

        console.log(`[EMAIL WORKER] Found ${result.rows.length} emails to send to Flow`);

        for (const email of result.rows) {
          try {
            // Flow'a gönder
            console.log(`[EMAIL WORKER] Processing email ID: ${email.id}`);
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
            } else {
              throw new Error(`Flow service error: ${flowResponse.error}`);
            }
          } catch (emailError) {
            console.error(`[EMAIL WORKER] Error processing email ID ${email.id}:`, emailError);
            // Her email için ayrı hata yönetimi - diğer emaillerin işlenmesini engellemez
            continue;
          }
        }

        // Transaction'ı commit et
        await client.query('COMMIT');
        console.log('[EMAIL WORKER] ✓ Successfully committed all changes');

      } catch (txError) {
        // Transaction hatası durumunda rollback
        await client.query('ROLLBACK');
        throw txError;
      }

      const duration = Date.now() - startTime;
      console.log(`\n[EMAIL WORKER] Total processing time: ${duration}ms`);
      
      return { 
        success: true, 
        details: `Processed in ${duration}ms` 
      };

    } catch (error) {
      console.error('[EMAIL WORKER] Critical error:', error);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('[EMAIL WORKER] Rollback error:', rollbackError);
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
      }

      try {
        await this.processor.disconnect();
      } catch (disconnectError) {
        console.error('[EMAIL WORKER] Error disconnecting:', disconnectError);
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
