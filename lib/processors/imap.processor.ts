import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import pool from '../db';
import { imapConfig, ATTACHMENTS_DIR } from '../config/imap.config';
import { EmailService } from '../services/email.service';
import { delay } from '../utils/common';

export default class EmailProcessor {
  private imap: Imap;
  private isProcessing: boolean = false;
  private batchSize: number = 10;
  private flowRateLimit: number = 1000; // 1 saniye delay

  constructor() {
    if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD || !process.env.IMAP_HOST) {
      throw new Error('Missing required IMAP configuration');
    }

    this.imap = new Imap(imapConfig);

    this.imap.on('error', (err) => {
      console.error('[IMAP ERROR] Connection error:', err);
    });

    mkdir(ATTACHMENTS_DIR, { recursive: true }).catch(error => {
      console.error('[IMAP ERROR] Failed to create attachments directory:', error);
    });
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', resolve);
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  private async disconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.imap.once('end', resolve);
      this.imap.end();
    });
  }

  private async addFlag(uid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const flagTimeout = setTimeout(() => {
        reject(new Error(`Flag timeout for UID #${uid}`));
      }, 5000);

      this.imap.setFlags(uid, ['\\Flagged'], (err) => {
        clearTimeout(flagTimeout);
        if (err) {
          console.error(`[FLAG ERROR] Failed to flag email UID #${uid}:`, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async processBatch(emails: number[], client: any): Promise<void> {
    const fetch = this.imap.fetch(emails, { 
      bodies: '',
      struct: true,
      flags: true
    });

    const processPromises: Promise<void>[] = [];

    fetch.on('message', (msg, seqno) => {
      const processPromise = new Promise<void>((resolveProcess, rejectProcess) => {
        let messageAttributes: any = null;

        const attributesPromise = new Promise((resolveAttr) => {
          msg.once('attributes', (attrs) => {
            console.log(`[IMAP] Message #${seqno} flags:`, attrs.flags);
            messageAttributes = attrs;
            resolveAttr(attrs);
          });
        });

        msg.on('body', async (stream) => {
          try {
            await attributesPromise;

            if (!messageAttributes || !messageAttributes.uid) {
              throw new Error(`Message attributes or UID not available for message #${seqno}`);
            }

            const parsed = await simpleParser(stream);
            const uid = messageAttributes.uid;

            const flags = messageAttributes.flags || [];
            if (flags.includes('\\Flagged')) {
              console.log(`[IMAP] Skipping message #${seqno} (UID: ${uid}) as it's already flagged`);
              resolveProcess();
              return;
            }

            try {
              await this.addFlag(uid);
              console.log(`[IMAP] Successfully flagged email UID ${uid}`);
            } catch (flagError) {
              console.error(`[IMAP ERROR] Failed to flag email UID ${uid}:`, flagError);
              rejectProcess(flagError);
              return;
            }

            await EmailService.processEmail(client, uid, parsed);

            // Flow'a gönderim için rate limit kontrolü
            if (process.env.autosenttoflow === '1') {
              await delay(this.flowRateLimit);
            }

            resolveProcess();
          } catch (error) {
            console.error(`[IMAP ERROR] Failed to process message #${seqno}:`, error);
            rejectProcess(error);
          }
        });

        msg.once('error', (err) => {
          console.error('[IMAP ERROR] Error processing message:', err);
          rejectProcess(err);
        });
      });

      processPromises.push(processPromise);
    });

    fetch.once('error', (err) => {
      console.error('[IMAP ERROR] Error during fetch:', err);
      throw err;
    });

    await new Promise<void>((resolve, reject) => {
      fetch.once('end', async () => {
        try {
          console.log(`[IMAP] Processing ${processPromises.length} emails in batch`);
          for (const promise of processPromises) {
            await promise.catch(error => {
              console.error('[IMAP ERROR] Error processing email:', error);
            });
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      fetch.once('error', reject);
    });
  }

  public async processEmails(): Promise<void> {
    let client = null;

    try {
      if (this.isProcessing) {
        console.log('[IMAP] Another process is already running, skipping...');
        return;
      }

      this.isProcessing = true;

      if (!pool) {
        throw new Error('Database connection pool not initialized');
      }

      client = await pool.connect();
      if (!client) {
        throw new Error('Failed to acquire database client');
      }

      await this.connect();
      
      const openBox = promisify(this.imap.openBox.bind(this.imap));
      await openBox('INBOX', false);

      const search = promisify(this.imap.search.bind(this.imap));
      console.log('[IMAP] Searching for unprocessed emails...');
      
      const unprocessedEmails = await search(['UNFLAGGED']);
      
      if (unprocessedEmails.length === 0) {
        console.log('[IMAP] No unprocessed emails found');
        return;
      }

      console.log(`[IMAP] Found ${unprocessedEmails.length} unprocessed emails`);

      // Batch processing
      for (let i = 0; i < unprocessedEmails.length; i += this.batchSize) {
        const batch = unprocessedEmails.slice(i, i + this.batchSize);
        console.log(`[IMAP] Processing batch ${i / this.batchSize + 1} of ${Math.ceil(unprocessedEmails.length / this.batchSize)}`);
        await this.processBatch(batch, client);
      }

    } catch (error) {
      console.error('[IMAP ERROR] Error in email processing:', error);
      throw error;
    } finally {
      this.isProcessing = false;
      if (client) {
        try {
          await client.query('ROLLBACK').catch(console.error);
          client.release();
          console.log('[DB] Database connection released');
        } catch (error) {
          console.error('[DB ERROR] Error releasing client:', error);
        }
      }
      try {
        await this.disconnect();
        console.log('[IMAP] Disconnected from IMAP server');
      } catch (error) {
        console.error('[IMAP ERROR] Error disconnecting:', error);
      }
    }
  }
}