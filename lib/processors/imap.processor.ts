import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import pool from '../db';
import { imapConfig } from '../config/imap.config';
import { EmailService } from '../services/email.service';
import { delay } from '../utils/common';
import path from 'path';
import { logWorker } from '../utils/logger';

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
    logWorker.start(`Attachments directory: ${this.attachmentsDir}`);

    this.imap.on('error', (err) => {
      logWorker.error('IMAP connection error:', err);
    });

    mkdir(this.attachmentsDir, { recursive: true }).catch(error => {
      logWorker.error('Failed to create attachments directory:', error);
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

  private async deleteEmail(uid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deleteTimeout = setTimeout(() => {
        reject(new Error(`Delete timeout for UID #${uid}`));
      }, 5000);

      this.imap.addFlags(uid, ['\\Deleted'], (err) => {
        if (err) {
          clearTimeout(deleteTimeout);
          logWorker.error(`Failed to mark email UID #${uid} for deletion:`, err);
          reject(err);
          return;
        }

        // Expunge the message to permanently delete it
        this.imap.expunge([uid], (expungeErr) => {
          clearTimeout(deleteTimeout);
          if (expungeErr) {
            logWorker.error(`Failed to expunge email UID #${uid}:`, expungeErr);
            reject(expungeErr);
          } else {
            logWorker.success(`Successfully deleted email UID #${uid}`);
            resolve();
          }
        });
      });
    });
  }

  private async processBatch(emails: number[], client: any): Promise<void> {
    logWorker.start(`Processing batch of ${emails.length} emails`);

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
            logWorker.start(`Message #${seqno} flags: ${attrs.flags}`);
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
            if (flags.includes('\\Deleted')) {
              logWorker.email.skip(uid, 'already marked for deletion');
              resolveProcess();
              return;
            }

            try {
              // Email'i işle - şimdi bir emailId dönecek
              logWorker.email.start(uid);
              const emailId = await EmailService.processEmail(client, uid, parsed);
              
              // Eğer email başarıyla işlendiyse
              if (emailId !== null) {
                // Veritabanına başarılı kayıt sonrası, hemen sil
                await this.deleteEmail(uid);
                logWorker.email.success(uid);
                
                // Not: Flow'a gönderim zaten EmailService içinde yapılıyor
                // ve Flow hatası olması halinde e-posta silinmesi etkilenmiyor
              }
              
              // İşlem başarısız olsa bile promise'i çözüyoruz
              resolveProcess();
            } catch (error) {
              logWorker.email.error(uid, error);
              rejectProcess(error);
            }
          } catch (error) {
            logWorker.error(`Failed to process message #${seqno}:`, error);
            rejectProcess(error);
          }
        });

        msg.once('error', (err) => {
          logWorker.error('Error processing message:', err);
          rejectProcess(err);
        });
      });

      processPromises.push(processPromise);
    });

    fetch.once('error', (err) => {
      logWorker.error('Error during fetch:', err);
      throw err;
    });

    await new Promise<void>((resolve, reject) => {
      fetch.once('end', async () => {
        try {
          logWorker.start(`Processing ${processPromises.length} emails in batch`);
          // Process emails sequentially instead of in parallel
          for (const promise of processPromises) {
            await promise.catch(error => {
              logWorker.error('Error processing email:', error);
            });
            // Add a small delay between processing each email to prevent API congestion
            await delay(3000); 
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
        logWorker.start('Another process is already running, skipping...');
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
      const search = promisify(this.imap.search.bind(this.imap));
      const getBoxes = promisify(this.imap.getBoxes.bind(this.imap));

      // List all available mailboxes
      logWorker.start('Listing all mailboxes...');
      const boxes = await getBoxes();
      logWorker.success('Available mailboxes:', Object.keys(boxes));

      // Process spam folder - using full path with INBOX prefix
      const foldersToProcess = ['INBOX','INBOX.spam'];
      
      for (const folder of foldersToProcess) {
        try {
          logWorker.start(`Processing ${folder} folder...`);
          await openBox(folder, false);
          
          logWorker.start(`Searching for unprocessed emails in ${folder}...`);
          const unprocessedEmails = await search(['UNFLAGGED']);
          
          if (unprocessedEmails.length === 0) {
            logWorker.success(`No unprocessed emails found in ${folder}`);
            continue;
          }

          logWorker.success(`Found ${unprocessedEmails.length} unprocessed emails in ${folder}`);

          // Process emails in batches
          for (let i = 0; i < unprocessedEmails.length; i += this.batchSize) {
            const batch = unprocessedEmails.slice(i, i + this.batchSize);
            logWorker.start(`Processing batch ${i / this.batchSize + 1} of ${Math.ceil(unprocessedEmails.length / this.batchSize)}`);
            await this.processBatch(batch, client);
          }
        } catch (error) {
          logWorker.error(`Error processing ${folder} folder:`, error);
          // Continue with next folder even if current one fails
          continue;
        }
      }

    } catch (error) {
      logWorker.error('Error in processEmails:', error);
      throw error;
    } finally {
      if (client) {
        client.release();
      }
      this.isProcessing = false;
      await this.disconnect();
    }
  }
}