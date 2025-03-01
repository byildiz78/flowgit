import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import pool from '../db';
import { imapConfig } from '../config/imap.config';
import { EmailService } from '../services/email.service';
import { FlowService } from '../services/flow.service'; // Import FlowService
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

    // Promise'leri sıralı işlemek için bir dizi oluştur
    const emailsToProcess: Array<{msg: any, seqno: number}> = [];

    fetch.on('message', (msg, seqno) => {
      // Mesajları hemen işlemek yerine diziye ekle
      emailsToProcess.push({msg, seqno});
    });

    fetch.once('error', (err) => {
      logWorker.error('Error during fetch:', err);
      throw err;
    });

    await new Promise<void>((resolve, reject) => {
      fetch.once('end', async () => {
        try {
          logWorker.start(`Processing ${emailsToProcess.length} emails in batch sequentially`);
          
          // Her e-postayı sırayla işle
          for (const {msg, seqno} of emailsToProcess) {
            try {
              let messageAttributes: any = null;
              
              // Mesaj özelliklerini al
              await new Promise<void>((resolveAttr) => {
                msg.once('attributes', (attrs) => {
                  logWorker.start(`Message #${seqno} flags: ${attrs.flags}`);
                  messageAttributes = attrs;
                  resolveAttr();
                });
              });

              if (!messageAttributes || !messageAttributes.uid) {
                throw new Error(`Message attributes or UID not available for message #${seqno}`);
              }

              const uid = messageAttributes.uid;
              const flags = messageAttributes.flags || [];
              
              if (flags.includes('\\Deleted')) {
                logWorker.email.skip(uid, 'already marked for deletion');
                continue;
              }

              // Mesaj içeriğini işle
              await new Promise<void>((resolveBody, rejectBody) => {
                msg.on('body', async (stream) => {
                  try {
                    const parsed = await simpleParser(stream);
                    
                    // Email'i işle - veritabanına kaydet
                    logWorker.email.start(uid);
                    
                    // Önce e-postayı veritabanına kaydet (senttoflow=false olarak)
                    const emailId = await EmailService.processEmail(client, uid, parsed);
                    
                    // Veritabanına kayıt başarılı olduysa, IMAP'den sil
                    await this.deleteEmail(uid);
                    logWorker.success(`Successfully deleted email UID #${uid} from IMAP after DB save`);
                    
                    // Şimdi Flow'a göndermeyi dene
                    if (process.env.autosenttoflow === '1' && emailId) {
                      try {
                        // Flow'a gönder
                        const flowSuccess = await FlowService.sendToFlow(client, emailId, parsed);
                        
                        if (flowSuccess) {
                          // Flow'a gönderme başarılı olduysa senttoflow alanını true yap
                          await client.query(
                            'UPDATE emails SET senttoflow = true WHERE id = $1',
                            [emailId]
                          );
                          logWorker.success(`Email #${emailId} (UID #${uid}) sent to Flow successfully and marked as sent`);
                        } else {
                          logWorker.warn(`Email #${emailId} (UID #${uid}) could not be sent to Flow, will retry later`);
                        }
                        
                        // Flow'a gönderim için rate limit kontrolü
                        await delay(this.flowRateLimit);
                      } catch (flowError) {
                        logWorker.error(`Flow API error for email #${emailId} (UID #${uid}):`, flowError);
                        // Flow'a gönderme başarısız olsa bile devam et
                        // E-posta veritabanında ve senttoflow=false olarak işaretli
                      }
                    }
                    
                    logWorker.email.success(uid);
                    resolveBody();
                  } catch (error) {
                    logWorker.email.error(uid, error);
                    rejectBody(error);
                  }
                });

                msg.once('error', (err) => {
                  logWorker.error('Error processing message:', err);
                  rejectBody(err);
                });
              }).catch(error => {
                logWorker.error(`Error processing message #${seqno}:`, error);
                // Hata olsa bile diğer e-postaları işlemeye devam et
              });
              
            } catch (error) {
              logWorker.error(`Failed to process message #${seqno}:`, error);
              // Hata olsa bile diğer e-postaları işlemeye devam et
            }
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