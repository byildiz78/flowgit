import { parentPort } from 'worker_threads';
import { EmailProcessor } from '../processors/imap.processor';
import pool from '../db';
import { FlowService } from '../services/flow.service';

export class EmailWorker {
  private static instance: EmailWorker;
  private processor: EmailProcessor;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  private readonly STUCK_EMAIL_THRESHOLD = 10 * 60 * 1000; // 10 dakika
  private lastProcessingTime: number = 0;

  private constructor() {
    this.processor = new EmailProcessor();
  }

  public static getInstance(): EmailWorker {
    if (!EmailWorker.instance) {
      EmailWorker.instance = new EmailWorker();
    }
    return EmailWorker.instance;
  }

  public stop() {
    this.shouldStop = true;
    console.log('[EMAIL WORKER] Stop signal received, gracefully shutting down...');
  }

  private async isAnotherProcessRunning(): Promise<boolean> {
    // Son işlemden bu yana 5 dakika geçtiyse, isProcessing'i sıfırla
    const PROCESS_TIMEOUT = 5 * 60 * 1000; // 5 dakika
    if (this.isProcessing && Date.now() - this.lastProcessingTime > PROCESS_TIMEOUT) {
      console.log('[EMAIL WORKER] Processing flag was stuck, resetting...');
      this.isProcessing = false;
      return false;
    }
    return this.isProcessing;
  }

  private async commitOrRollback(client: PoolClient, success: boolean) {
    try {
      if (success) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }
    } catch (error) {
      console.error('[EMAIL WORKER] Error in transaction commit/rollback:', error);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[EMAIL WORKER] Error in rollback:', rollbackError);
      }
    }
  }

  private async resetStuckEmails(client: PoolClient): Promise<void> {
    try {
      // İşlemde takılı kalmış emailleri bul ve reset et
      const stuckEmailsQuery = `
        UPDATE emails 
        SET processing = false,
            processing_started_at = NULL,
            processing_completed_at = NULL
        WHERE processing = true 
        AND processing_started_at < NOW() - INTERVAL '10 minutes'
        RETURNING id, subject;
      `;

      const result = await client.query(stuckEmailsQuery);
      
      if (result.rows.length > 0) {
        console.log(`[EMAIL WORKER] Found ${result.rows.length} stuck emails and reset their status:`);
        for (const email of result.rows) {
          console.log(`[EMAIL WORKER] - Email ID: ${email.id}, Subject: ${email.subject}`);
          await logFailedEmail(client, email.id, 'Email processing was stuck and reset by worker startup');
        }
      }
    } catch (error) {
      console.error('[EMAIL WORKER] Error resetting stuck emails:', error);
    }
  }

  private async markEmailProcessing(client: PoolClient, emailId: number): Promise<boolean> {
    try {
      const result = await client.query(`
        UPDATE emails 
        SET processing = true,
            processing_started_at = NOW()
        WHERE id = $1 
        AND (processing = false OR processing_started_at < NOW() - INTERVAL '10 minutes')
        RETURNING id
      `, [emailId]);

      const success = result.rows.length > 0;
      if (success) {
        console.log(`[EMAIL WORKER] ✓ Marked email ${emailId} as processing`);
      }
      return success;
    } catch (error) {
      console.error(`[EMAIL WORKER] Error marking email ${emailId} as processing:`, error);
      return false;
    }
  }

  private async unmarkEmailProcessing(client: PoolClient, emailId: number, isError: boolean = false): Promise<void> {
    try {
      const result = await client.query(`
        UPDATE emails 
        SET processing = false,
            processing_started_at = NULL,
            processing_completed_at = ${isError ? 'NULL' : 'NOW()'}
        WHERE id = $1
        RETURNING id
      `, [emailId]);

      if (result.rows.length > 0) {
        console.log(`[EMAIL WORKER] ✓ Unmarked email ${emailId} processing status`);
      }
    } catch (error) {
      console.error(`[EMAIL WORKER] Error unmarking email ${emailId} processing status:`, error);
    }
  }

  async processEmails(): Promise<{ success: boolean; error?: string; details?: string }> {
    if (await this.isAnotherProcessRunning()) {
      console.log('[EMAIL WORKER] Another process is still running, skipping this cycle...');
      return { success: false, error: 'Another process is still running' };
    }

    this.isProcessing = true;
    this.lastProcessingTime = Date.now();
    this.shouldStop = false;
    let client = null;

    try {
      client = await pool.connect();
      
      // Worker başlarken takılı kalmış emailleri resetle
      await this.resetStuckEmails(client);

      while (!this.shouldStop) {
        const result = await client.query(`
          SELECT * FROM emails 
          WHERE senttoflow = false 
          AND (processing = false OR processing_started_at < NOW() - INTERVAL '10 minutes')
          ORDER BY received_date ASC
          LIMIT 5
        `);

        if (result.rows.length === 0) {
          console.log('[EMAIL WORKER] No more emails to process');
          break;
        }

        console.log(`[EMAIL WORKER] Processing batch of ${result.rows.length} emails...`);

        for (const email of result.rows) {
          this.lastProcessingTime = Date.now();

          if (this.shouldStop) {
            console.log('[EMAIL WORKER] Stop requested, finishing current email...');
            break;
          }

          try {
            // Email'i işleme aldığımızı işaretle
            await client.query('BEGIN');
            
            const canProcess = await this.markEmailProcessing(client, email.id);
            if (!canProcess) {
              console.log(`[EMAIL WORKER] Email ${email.id} is being processed by another worker, skipping...`);
              await client.query('ROLLBACK');
              continue;
            }

            // Email'i Flow'a gönder
            await FlowService.sendToFlow(client, email.id, email);

            // İşlem başarılı olduğunda processing durumunu güncelle
            await client.query(`
              UPDATE emails 
              SET processing = false,
                  processing_started_at = NULL,
                  processing_completed_at = NOW()
              WHERE id = $1
            `, [email.id]);

            // Transaction'ı commit et
            await client.query('COMMIT');
            console.log(`[EMAIL WORKER] ✓ Successfully processed email ${email.id}`);

          } catch (error) {
            console.error(`[EMAIL WORKER] ✗ Error processing email ${email.id}:`, error);
            await client.query('ROLLBACK');
            
            // Yeni transaction başlat ve hata durumunu kaydet
            await client.query('BEGIN');
            await this.unmarkEmailProcessing(client, email.id, true);
            await logFailedEmail(client, email.id, 'Processing error occurred');
            await client.query('COMMIT');
          }
        }

        if (!this.shouldStop) {
          console.log(`[EMAIL WORKER] Batch complete. Waiting 2000ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      return { success: true };
    } catch (error) {
      console.error('[EMAIL WORKER] Error in process:', error);
      return { success: false, error: error.message };
    } finally {
      this.isProcessing = false;
      if (client) {
        client.release();
      }
      if (this.shouldStop) {
        console.log('[EMAIL WORKER] Worker stopped gracefully');
      }
    }
  }
}

// Worker thread message handler
let worker: EmailWorker | null = null;

parentPort?.on('message', async (message) => {
  if (message === 'start') {
    worker = EmailWorker.getInstance();
    const result = await worker.processEmails();
    parentPort?.postMessage(result);
  } else if (message === 'stop' && worker) {
    worker.stop();
  }
});
