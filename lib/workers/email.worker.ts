import { parentPort } from 'worker_threads';
import { EmailProcessor } from '../processors/imap.processor';
import pool from '../db';
import { FlowService } from '../services/flow.service';

export class EmailWorker {
  private processor: EmailProcessor;
  private isProcessing: boolean = false;
  private shouldStop: boolean = false;
  private readonly STUCK_EMAIL_THRESHOLD = 10 * 60 * 1000; // 10 dakika

  constructor() {
    this.processor = new EmailProcessor();
  }

  public stop() {
    this.shouldStop = true;
    console.log('[EMAIL WORKER] Stop signal received, gracefully shutting down...');
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
            processing_started_at = NULL
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

      return result.rows.length > 0;
    } catch (error) {
      console.error(`[EMAIL WORKER] Error marking email ${emailId} as processing:`, error);
      return false;
    }
  }

  private async unmarkEmailProcessing(client: PoolClient, emailId: number): Promise<void> {
    try {
      await client.query(`
        UPDATE emails 
        SET processing = false,
            processing_started_at = NULL
        WHERE id = $1
      `, [emailId]);
    } catch (error) {
      console.error(`[EMAIL WORKER] Error unmarking email ${emailId} processing status:`, error);
    }
  }

  async processEmails(): Promise<{ success: boolean; error?: string; details?: string }> {
    if (this.isProcessing) {
      console.log('[EMAIL WORKER] Already processing emails, skipping...');
      return { success: false, error: 'Already processing emails' };
    }

    this.isProcessing = true;
    this.shouldStop = false;
    let client = null;

    try {
      client = await pool.connect();
      
      // Worker başlarken takılı kalmış emailleri resetle
      await this.resetStuckEmails(client);

      while (!this.shouldStop) {
        await client.query('BEGIN');
        
        const result = await client.query(`
          SELECT * FROM emails 
          WHERE senttoflow = false 
          AND (processing = false OR processing_started_at < NOW() - INTERVAL '10 minutes')
          ORDER BY received_date ASC
          LIMIT 5
        `);

        if (result.rows.length === 0) {
          await client.query('COMMIT');
          console.log('[EMAIL WORKER] No more emails to process');
          break;
        }

        console.log(`[EMAIL WORKER] Processing batch of ${result.rows.length} emails...`);
        let currentBatchSuccess = true;

        for (const email of result.rows) {
          if (this.shouldStop) {
            console.log('[EMAIL WORKER] Stop requested, finishing current email...');
            break;
          }

          // Email'i işleme aldığımızı işaretle
          const canProcess = await this.markEmailProcessing(client, email.id);
          if (!canProcess) {
            console.log(`[EMAIL WORKER] Email ${email.id} is being processed by another worker, skipping...`);
            continue;
          }

          try {
            const success = await processEmailWithTimeout(email, client, 5000);
            if (!success) {
              currentBatchSuccess = false;
              await logFailedEmail(client, email.id, 'Processing timeout or error occurred');
            }
          } finally {
            // İşlem bittiğinde processing flag'i kaldır
            await this.unmarkEmailProcessing(client, email.id);
          }
        }

        await this.commitOrRollback(client, currentBatchSuccess);

        if (!this.shouldStop) {
          console.log(`[EMAIL WORKER] Batch complete. Waiting 2000ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      return { success: true };
    } catch (error) {
      console.error('[EMAIL WORKER] Error in process:', error);
      if (client) {
        await this.commitOrRollback(client, false);
      }
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
parentPort?.on('message', async (message) => {
  if (message === 'start') {
    const worker = new EmailWorker();
    const result = await worker.processEmails();
    parentPort?.postMessage(result);
  } else if (message === 'stop') {
    const worker = new EmailWorker();
    worker.stop();
  }
});
