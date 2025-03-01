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
  private batchSize: number = 3;
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
    logWorker.start('Attempting to establish IMAP connection...');
    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        logWorker.error('IMAP connect timeout occurred');
        reject(new Error('IMAP connection timeout after 20 seconds'));
      }, 20000); // 20 second timeout
      
      this.imap.once('ready', () => {
        clearTimeout(connectTimeout);
        logWorker.success('IMAP connection established successfully');
        resolve();
      });
      
      this.imap.once('error', (err) => {
        clearTimeout(connectTimeout);
        logWorker.error('IMAP connection error during connect:', err);
        reject(err);
      });
      
      this.imap.connect();
    });
  }

  private async disconnect(): Promise<void> {
    return new Promise<void>((resolve) => {
      const disconnectTimeout = setTimeout(() => {
        logWorker.error('IMAP disconnect timeout occurred, forcing resolution');
        resolve(); // Force resolve after timeout
      }, 10000); // 10 second timeout
      
      this.imap.once('end', () => {
        clearTimeout(disconnectTimeout);
        logWorker.success('IMAP connection closed successfully');
        resolve();
      });
      
      logWorker.start('Attempting to close IMAP connection...');
      this.imap.end();
    });
  }

  private async deleteEmail(uid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      logWorker.start(`Setting \\Deleted flag for email UID #${uid}`);
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

        logWorker.success(`Successfully added \\Deleted flag to email UID #${uid}`);
        // Expunge the message to permanently delete it
        logWorker.start(`Expunging email UID #${uid}`);
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
    logWorker.start(`Starting IMAP fetch for UIDs: ${emails.join(', ')}`);

    const fetch = this.imap.fetch(emails, { 
      bodies: '',
      struct: true,
      flags: true
    });

    const processPromises: Promise<void>[] = [];

    fetch.on('message', (msg, seqno) => {
      logWorker.start(`IMAP message event received for message #${seqno}`);
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
            logWorker.start(`Received body stream for message #${seqno}`);
            await attributesPromise;

            if (!messageAttributes || !messageAttributes.uid) {
              throw new Error(`Message attributes or UID not available for message #${seqno}`);
            }

            const uid = messageAttributes.uid;
            logWorker.start(`Parsing email UID #${uid} body content`);
            const parsed = await simpleParser(stream);
            logWorker.success(`Email UID #${uid} parsed successfully`);

            const flags = messageAttributes.flags || [];
            if (flags.includes('\\Deleted')) {
              logWorker.email.skip(uid, 'already marked for deletion');
              resolveProcess();
              return;
            }

            try {
              // Email'i işle - şimdi bir emailId dönecek
              logWorker.email.start(uid);
              logWorker.start(`Processing email UID #${uid} with EmailService`);
              const emailId = await EmailService.processEmail(client, uid, parsed);
              
              // Eğer email başarıyla işlendiyse
              if (emailId !== null) {
                logWorker.start(`Email UID #${uid} processed successfully, emailId=${emailId}`);
                // ÖNEMLİ: Veritabanına başarılı kayıt sonrası, Flow'a göndermeden ÖNCE sil
                logWorker.start(`Attempting to delete email UID #${uid} from IMAP`);
                await this.deleteEmail(uid);
                logWorker.email.success(uid);
                
                // Mail IMAP'ten silindikten SONRA Flow'a gönder
                if (process.env.autosenttoflow === '1') {
                  try {
                    logWorker.start(`Sending email #${emailId} to Flow after IMAP deletion`);
                    await EmailService.sendEmailToFlow(client, emailId, parsed);
                    logWorker.success(`Email #${emailId} sent to Flow after IMAP deletion`);
                  } catch (flowError) {
                    logWorker.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, flowError);
                    // Flow hatası zaten mail silindikten sonra oluşuyor, veritabanında email kaydı var
                  }
                }
              } else {
                logWorker.email.skip(uid, 'EmailService.processEmail returned null');
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
        logWorker.success('IMAP fetch completed');
        try {
          logWorker.start(`Processing ${processPromises.length} emails in batch`);
          // Process emails sequentially instead of in parallel
          for (let i = 0; i < processPromises.length; i++) {
            const promise = processPromises[i];
            logWorker.start(`Processing email ${i+1}/${processPromises.length} in batch`);
            await promise.catch(error => {
              logWorker.error('Error processing email:', error);
            });
            // Add a small delay between processing each email to prevent API congestion
            logWorker.start(`Applying rate limit delay of ${this.flowRateLimit}ms`); 
            await delay(this.flowRateLimit); 
          }
          logWorker.success('Batch processing completed successfully');
          resolve();
        } catch (error) {
          logWorker.error('Error processing batch:', error);
          reject(error);
        }
      });
      fetch.once('error', reject);
    });
  }

  public async processEmails(): Promise<void> {
    let client = null;
    let isConnected = false;
    const processStartTime = Date.now();

    try {
      if (this.isProcessing) {
        logWorker.start('Another process is already running, skipping...');
        return;
      }

      this.isProcessing = true;
      logWorker.start('Email processor starting new processing cycle');

      if (!pool) {
        throw new Error('Database connection pool not initialized');
      }

      logWorker.start('Acquiring database client from pool');
      client = await pool.connect();
      if (!client) {
        throw new Error('Failed to acquire database client');
      }
      logWorker.success('Database client acquired successfully');

      logWorker.start('Connecting to IMAP server');
      await this.connect();
      isConnected = true;
      
      const openBox = promisify(this.imap.openBox.bind(this.imap));
      const search = promisify(this.imap.search.bind(this.imap));
      const getBoxes = promisify(this.imap.getBoxes.bind(this.imap));

      // List all available mailboxes
      logWorker.start('Listing all mailboxes...');
      const boxes = await getBoxes();
      logWorker.success('Available mailboxes:', Object.keys(boxes));

      // Process spam folder - using full path with INBOX prefix
      const foldersToProcess = ['INBOX','INBOX.spam'];
      logWorker.start(`Will process the following folders: ${foldersToProcess.join(', ')}`);
      
      for (const folder of foldersToProcess) {
        const folderStartTime = Date.now();
        try {
          logWorker.start(`Processing ${folder} folder...`);
          logWorker.start(`Opening mailbox: ${folder}`);
          await openBox(folder, false);
          logWorker.success(`Successfully opened mailbox: ${folder}`);
          
          logWorker.start(`Searching for unprocessed emails in ${folder}...`);
          const unprocessedEmails = await search(['UNFLAGGED']);
          
          if (unprocessedEmails.length === 0) {
            logWorker.success(`No unprocessed emails found in ${folder}`);
            continue;
          }

          logWorker.success(`Found ${unprocessedEmails.length} unprocessed emails in ${folder}`);

          // Process emails in batches
          const totalBatches = Math.ceil(unprocessedEmails.length / this.batchSize);
          logWorker.start(`Will process ${totalBatches} batches with batch size ${this.batchSize}`);
          
          for (let i = 0; i < unprocessedEmails.length; i += this.batchSize) {
            const batchStartTime = Date.now();
            const batch = unprocessedEmails.slice(i, i + this.batchSize);
            logWorker.start(`Processing batch ${i / this.batchSize + 1} of ${Math.ceil(unprocessedEmails.length / this.batchSize)}`);
            await this.processBatch(batch, client);
            const batchDuration = Date.now() - batchStartTime;
            logWorker.success(`Batch ${i / this.batchSize + 1} completed in ${batchDuration}ms`);
          }
          
          const folderDuration = Date.now() - folderStartTime;
          logWorker.success(`Processing of folder ${folder} completed in ${folderDuration}ms`);
        } catch (error) {
          logWorker.error(`Error processing ${folder} folder:`, error);
          // Continue with next folder even if current one fails
          continue;
        }
      }

      const processDuration = Date.now() - processStartTime;
      logWorker.success(`All folders processed in ${processDuration}ms`);

    } catch (error) {
      logWorker.error('Error in processEmails:', error);
      throw error;
    } finally {
      if (client) {
        logWorker.start('Releasing database client back to pool');
        client.release();
        logWorker.success('Database client released');
      }
      
      if (isConnected) {
        try {
          logWorker.start('Attempting to disconnect from IMAP...');
          await this.disconnect();
        } catch (disconnectError) {
          logWorker.error('Error during IMAP disconnect:', disconnectError);
        }
      }
      
      this.isProcessing = false;
      const totalDuration = Date.now() - processStartTime;
      logWorker.success(`Email processing completed in ${totalDuration}ms`);
    }
  }
}