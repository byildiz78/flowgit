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
        AND processing_started_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
        RETURNING id, subject, processing_started_at, processing_completed_at;
      `;

      const result = await client.query(stuckEmailsQuery);
      
      if (result.rows.length > 0) {
        console.log(`[EMAIL WORKER] Found ${result.rows.length} stuck emails and reset their status:`);
        for (const email of result.rows) {
          console.log(`[EMAIL WORKER] - Email ID: ${email.id}, Subject: ${email.subject}, processing_started_at: ${email.processing_started_at}, processing_completed_at: ${email.processing_completed_at}`);
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
            processing_started_at = CURRENT_TIMESTAMP
        WHERE id = $1 
        AND (processing = false OR processing_started_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
        RETURNING id, processing_started_at
      `, [emailId]);

      const success = result.rows.length > 0;
      if (success) {
        console.log(`[EMAIL WORKER] ✓ Marked email ${emailId} as processing at ${result.rows[0].processing_started_at}`);
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
            processing_completed_at = CASE WHEN $2 THEN NULL ELSE CURRENT_TIMESTAMP END
        WHERE id = $1
        RETURNING id, processing_completed_at
      `, [emailId, isError]);

      if (result.rows.length > 0) {
        console.log(`[EMAIL WORKER] ✓ Unmarked email ${emailId} processing status, completed_at: ${result.rows[0].processing_completed_at}`);
      }
    } catch (error) {
      console.error(`[EMAIL WORKER] Error unmarking email ${emailId} processing status:`, error);
    }
  }

  private async processEmail(client: PoolClient, email: any): Promise<boolean> {
    const startTime = Date.now();
    try {
      // Transaction başlat
      await client.query('BEGIN');

      // Email'i işleme aldığımızı işaretle
      const canProcess = await this.markEmailProcessing(client, email.id);
      if (!canProcess) {
        console.log(`[EMAIL WORKER] Email ${email.id} is being processed by another worker, skipping...`);
        await client.query('ROLLBACK');
        return false;
      }

      // Email'i Flow'a gönder
      const success = await FlowService.sendToFlow(client, email.id, email);
      
      if (success) {
        // Flow'a gönderme başarılı olduktan sonra processing durumunu güncelle
        await this.unmarkEmailProcessing(client, email.id, false);
        await client.query('COMMIT');
        console.log(`[EMAIL WORKER] ✓ Successfully processed email ${email.id} in ${Date.now() - startTime}ms`);
        return true;
      } else {
        // Flow'a gönderme başarısız olduysa
        await client.query('ROLLBACK');
        
        // Yeni transaction başlat ve hata durumunu kaydet
        await client.query('BEGIN');
        await this.unmarkEmailProcessing(client, email.id, true);
        await logFailedEmail(client, email.id, 'Failed to send to Flow');
        await client.query('COMMIT');
        return false;
      }
    } catch (error) {
      console.error(`[EMAIL WORKER] ✗ Error processing email ${email.id} after ${Date.now() - startTime}ms:`, error);
      
      try {
        await client.query('ROLLBACK');
        
        // Yeni transaction başlat ve hata durumunu kaydet
        await client.query('BEGIN');
        await this.unmarkEmailProcessing(client, email.id, true);
        await logFailedEmail(client, email.id, `Error: ${error.message}`);
        await client.query('COMMIT');
      } catch (rollbackError) {
        console.error(`[EMAIL WORKER] Error during rollback for email ${email.id}:`, rollbackError);
      }
      
      return false;
    } finally {
      this.lastProcessingTime = Date.now();
    }
  }

  async processEmails(): Promise<{ success: boolean; error?: string; details?: string }> {
    if (await this.isAnotherProcessRunning()) {
      console.log('[EMAIL WORKER] Another process is still running, skipping this cycle...');
      return { success: false, error: 'Another process is still running' };
    }

    const startTime = Date.now();
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
          SELECT e.*, p.parsed_mail 
          FROM emails e 
          LEFT JOIN parsed_emails p ON e.id = p.email_id
          WHERE e.senttoflow = false 
          AND e.flagged = true
          AND (e.processing = false OR e.processing_started_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
          ORDER BY e.received_date ASC 
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        if (result.rows.length === 0) {
          console.log('[EMAIL WORKER] No new emails to process');
          break;
        }

        const email = result.rows[0];
        await this.processEmail(client, email);
        
        // Add a delay between processing each email (3 seconds)
        const delayBetweenEmails = 3000; // 3 saniye
        console.log(`[EMAIL WORKER] Adding ${delayBetweenEmails}ms delay before processing next email...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenEmails));

        // Her email sonrası processing flag'ini kontrol et
        if (Date.now() - this.lastProcessingTime > 60000) { // 1 dakika
          console.log('[EMAIL WORKER] Processing timeout detected, stopping cycle...');
          break;
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[EMAIL WORKER] Process completed in ${duration}ms`);
      return { success: true };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[EMAIL WORKER] Error in process cycle after ${duration}ms:`, error);
      return { 
        success: false, 
        error: error.message,
        details: error.stack 
      };
    } finally {
      this.isProcessing = false;
      if (client) {
        client.release();
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
