import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import pool from '../db';
import { imapConfig } from '../config/imap.config';
import { EmailService } from '../services/email.service';
import { delay } from '../utils/common';
import path from 'path';

export class EmailProcessor {
  private imap: Imap;
  private isProcessing: boolean = false;
  private batchSize: number = 10;
  private flowRateLimit: number = 1000; // 1 saniye delay
  private attachmentsDir: string;

  constructor() {
    if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD || !process.env.IMAP_HOST) {
      throw new Error('Missing required IMAP configuration');
    }

    this.imap = new Imap(imapConfig);
    
    // Attachments dizinini ayarla
    const projectRoot = process.cwd();
    this.attachmentsDir = path.join(projectRoot, 'public', 'attachments');
    console.log('[IMAP] Attachments directory:', this.attachmentsDir);

    this.imap.on('error', (err) => {
      console.error('[IMAP ERROR] Connection error:', err);
    });

    mkdir(this.attachmentsDir, { recursive: true }).catch(error => {
      console.error('[IMAP ERROR] Failed to create attachments directory:', error);
    });
  }

  private async connect(): Promise<void> {
    console.log('[IMAP] Connecting to IMAP server...');
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        console.log('[IMAP] ✓ Connected to IMAP server');
        resolve();
      });
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  private async disconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.imap.once('end', () => {
        console.log('[IMAP] ✓ Disconnected from IMAP server');
        resolve();
      });
      this.imap.end();
    });
  }

  private async deleteMessage(uid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteTimeout = setTimeout(() => {
        reject(new Error(`Delete timeout for UID #${uid}`));
      }, 5000);

      this.imap.deleteMessages(uid, true, (err) => {
        clearTimeout(deleteTimeout);
        if (err) {
          console.error(`[DELETE ERROR] Failed to delete email UID #${uid}:`, err);
          reject(err);
        } else {
          console.log(`[IMAP] Email UID ${uid} deleted from IMAP server`);
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

            console.log(`\n[IMAP] Processing message UID: ${uid}`);
            console.log(`[IMAP] Message details:
              Subject: ${parsed.subject}
              From: ${parsed.from.value[0].address}
              Date: ${parsed.date}
            `);

            try {
              console.log('[IMAP] Saving to database...');
              await EmailService.processEmail(client, uid, parsed);
              console.log(`[IMAP] ✓ Saved to database`);

              console.log('[IMAP] Deleting from IMAP server...');
              await this.deleteMessage(uid);
              console.log(`[IMAP] ✓ Deleted from IMAP server`);
            } catch (error) {
              console.error(`[IMAP] ✗ Error processing email UID ${uid}:`, error);
              rejectProcess(error);
              return;
            }

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

  public async processEmails(): Promise<{ processed: number; errors: number }> {
    let client = null;
    let processed = 0;
    let errors = 0;

    try {
      if (this.isProcessing) {
        console.log('[IMAP] Another process is already running, skipping...');
        return { processed, errors };
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
      const search = promisify(this.imap.search.bind(this.imap));
      const getBoxes = promisify(this.imap.getBoxes.bind(this.imap));

      // List all available mailboxes
      console.log('[IMAP] Listing all mailboxes...');
      const boxes = await getBoxes();
      console.log('[IMAP] Available mailboxes:', Object.keys(boxes));

      // Process spam folder - using full path with INBOX prefix
      const foldersToProcess = ['INBOX','INBOX.spam'];
      
      for (const folder of foldersToProcess) {
        try {
          console.log(`[IMAP] Processing ${folder} folder...`);
          await openBox(folder, false);
          
          console.log(`[IMAP] Searching for unprocessed emails in ${folder}...`);
          const unprocessedEmails = await search(['UNFLAGGED']);
          
          if (unprocessedEmails.length === 0) {
            console.log(`[IMAP] No unprocessed emails found in ${folder}`);
            continue;
          }

          console.log(`[IMAP] Found ${unprocessedEmails.length} unprocessed emails in ${folder}`);

          // Process emails in batches
          for (let i = 0; i < unprocessedEmails.length; i += this.batchSize) {
            const batch = unprocessedEmails.slice(i, i + this.batchSize);
            console.log(`[IMAP] Processing batch ${i / this.batchSize + 1} of ${Math.ceil(unprocessedEmails.length / this.batchSize)}`);
            await this.processBatch(batch, client);
          }
        } catch (error) {
          console.error(`[IMAP ERROR] Error processing ${folder} folder:`, error);
          // Continue with next folder even if current one fails
          continue;
        }
      }

      console.log('\n[IMAP] ====== Processing Summary ======');
      console.log(`[IMAP] Total messages found: ${unprocessedEmails.length}`);
      console.log(`[IMAP] Successfully processed: ${processed}`);
      console.log(`[IMAP] Errors encountered: ${errors}`);
      console.log('[IMAP] ===============================\n');

    } catch (error) {
      console.error('[IMAP ERROR] Error in processEmails:', error);
      throw error;
    } finally {
      if (client) {
        client.release();
      }
      this.isProcessing = false;
      await this.disconnect();
    }

    return { processed, errors };
  }
}