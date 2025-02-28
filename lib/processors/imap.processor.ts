import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import pool from '../db';
import { imapConfig } from '../config/imap.config';
import { EmailService } from '../services/email.service';
import { FlowService } from '../services/flow.service'; // FlowService import edildi
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

  private async processEmailAndGetId(client: any, uid: number, parsed: any): Promise<number> {
    logWorker.email.start(uid);
    const emailId = await EmailService.processEmail(client, uid, parsed);
    logWorker.email.success(uid);
    return emailId;
  }

  private async processBatch(messagesToProcess: any[], client: any): Promise<void> {
    logWorker.start(`Processing ${messagesToProcess.length} emails sequentially`);
    
    // E-postaları sıralı olarak işle
    for (const messageData of messagesToProcess) {
      try {
        logWorker.start(`Starting to process message: ${messageData.seqno}`);
        const { msg, seqno, attributes } = messageData;
        
        if (!attributes || !attributes.uid) {
          logWorker.error(`Message attributes or UID not available for message #${seqno}`);
          continue;
        }

        const uid = attributes.uid;
        const flags = attributes.flags || [];
        
        logWorker.start(`Processing message UID: ${uid}, flags: ${flags.join(', ')}`);
        
        if (flags.includes('\\Deleted')) {
          logWorker.email.skip(uid, 'already marked for deletion');
          continue;
        }

        // E-posta içeriğini al
        logWorker.start(`Getting email content for UID: ${uid}`);
        try {
          const emailContent = await Promise.race([
            new Promise<Buffer>((resolve, reject) => {
              let buffer = Buffer.alloc(0);
              
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => {
                  buffer = Buffer.concat([buffer, chunk]);
                });
                
                stream.once('end', () => {
                  resolve(buffer);
                });
                
                stream.once('error', (err) => {
                  reject(err);
                });
              });
              
              msg.once('error', (err) => {
                reject(err);
              });
            }),
            // 30 saniye zaman aşımı ekle
            new Promise<Buffer>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Timeout getting email content for UID: ${uid} after 30 seconds`));
              }, 30000);
            })
          ]);
          
          logWorker.success(`Got email content for UID: ${uid}, size: ${emailContent.length} bytes`);

          // E-postayı parse et
          logWorker.start(`Parsing email content for UID: ${uid}`);
          const parsed = await simpleParser(emailContent);
          logWorker.success(`Parsed email for UID: ${uid}, subject: ${parsed.subject}`);

          // 1. E-posta'yı işle (veritabanına kaydet)
          logWorker.email.start(uid);
          logWorker.start(`Saving email to database for UID: ${uid}`);
          const emailId = await EmailService.processEmail(client, uid, parsed);
          logWorker.success(`Saved email to database for UID: ${uid}, emailId: ${emailId}`);
          
          // 2. Veritabanına kaydedildikten sonra, Flow'a göndermeden önce IMAP'den sil
          logWorker.start(`Deleting email from IMAP for UID: ${uid}`);
          await this.deleteEmail(uid);
          logWorker.email.success(uid);
          logWorker.success(`Deleted email from IMAP for UID: ${uid}`);

          // 3. Flow'a gönderim işlemi (silme işleminden sonra)
          if (process.env.autosenttoflow === '1' && emailId) {
            try {
              logWorker.start(`Sending email #${emailId} to Flow`);
              const flowResult = await FlowService.sendToFlow(client, emailId, parsed);
              
              if (flowResult) {
                logWorker.success(`Successfully sent email #${emailId} to Flow`);
              } else {
                logWorker.error(`Failed to send email #${emailId} to Flow: API returned false`);
              }
            } catch (flowError) {
              logWorker.error(`Failed to send email #${emailId} to Flow:`, flowError);
            }
            
            // 4. Flow'a gönderim için rate limit kontrolü
            logWorker.start(`Waiting ${this.flowRateLimit}ms before processing next email`);
            await delay(this.flowRateLimit);
            logWorker.success(`Finished waiting, ready for next email`);
          }
        } catch (contentError) {
          logWorker.error(`Error getting or processing email content for UID: ${uid}:`, contentError);
          logWorker.warn(`Skipping problematic email UID: ${uid} - it will remain on the IMAP server for manual inspection`);
        }
        
        logWorker.success(`Completed processing for message UID: ${uid}`);
      } catch (error) {
        logWorker.error(`Failed to process message:`, error);
      }
    }
    
    logWorker.success(`Completed processing batch of ${messagesToProcess.length} emails`);
  }

  private async processMailbox(client: any): Promise<void> {
    return new Promise((resolve, reject) => {
      // IMAP sunucusuna bağlan
      this.imap.once('ready', async () => {
        logWorker.success('Connected to IMAP server');

        const openBox = (mailbox: string, readonly: boolean): Promise<void> => {
          return new Promise((resolve, reject) => {
            this.imap.openBox(mailbox, readonly, (err: Error | null, box: any) => {
              if (err) {
                logWorker.error(`Error opening mailbox ${mailbox}:`, err);
                reject(err);
              } else {
                logWorker.success(`Opened mailbox ${mailbox}`);
                resolve();
              }
            });
          });
        };

        const search = (criteria: string[]): Promise<number[]> => {
          return new Promise((resolve, reject) => {
            logWorker.start(`Executing IMAP search with criteria: ${JSON.stringify(criteria)}`);
            this.imap.search(criteria, (err: Error | null, results: number[]) => {
              if (err) {
                logWorker.error(`IMAP search error:`, err);
                reject(err);
              } else {
                logWorker.success(`IMAP search returned ${results.length} results`);
                resolve(results);
              }
            });
          });
        };

        // List all available mailboxes
        logWorker.start('Listing all mailboxes...');
        const boxes = await this.imap.getBoxes();
        logWorker.success('Available mailboxes:', Object.keys(boxes));

        // Process spam folder - using full path with INBOX prefix
        const foldersToProcess = ['INBOX','INBOX.spam'];
        
        for (const folder of foldersToProcess) {
          try {
            logWorker.start(`Processing ${folder} folder...`);
            await openBox(folder, false);
            
            logWorker.start(`Searching for all emails in ${folder}...`);
            // ALL: Tüm e-postaları getir, flag durumuna bakma
            let allEmails: number[] = [];
            try {
              allEmails = await search(['ALL']);
              
              if (allEmails.length === 0) {
                logWorker.success(`No emails found in ${folder}`);
                continue;
              }

              logWorker.success(`Found ${allEmails.length} emails in ${folder}`);
            } catch (error) {
              logWorker.error(`Error searching for all emails in ${folder}:`, error);
              continue;
            }

            // Process emails in batches
            for (let i = 0; i < allEmails.length; i += this.batchSize) {
              const batch = allEmails.slice(i, i + this.batchSize);
              logWorker.start(`Processing batch ${i / this.batchSize + 1} of ${Math.ceil(allEmails.length / this.batchSize)}`);
              
              // Fetch email details for this batch
              logWorker.start(`Processing batch of ${batch.length} emails`);
              
              const fetch = this.imap.fetch(batch, { 
                bodies: '',
                struct: true,
                flags: true
              });
              
              // E-postaları sıralı işlemek için dizi
              const messagesToProcess: { msg: any, seqno: number, attributes: any }[] = [];
              
              // Tüm mesajları topla
              await new Promise<void>((resolve, reject) => {
                fetch.on('message', (msg, seqno) => {
                  const messageData = { msg, seqno, attributes: null };
                  
                  msg.once('attributes', (attrs) => {
                    logWorker.start(`Message #${seqno} flags: ${attrs.flags ? attrs.flags.join(', ') : ''}`);
                    messageData.attributes = attrs;
                  });
                  
                  messagesToProcess.push(messageData);
                });
                
                fetch.once('end', () => {
                  logWorker.start(`Collected ${messagesToProcess.length} messages for sequential processing`);
                  resolve();
                });
                
                fetch.once('error', (err) => {
                  logWorker.error('Error during fetch:', err);
                  reject(err);
                });
              });
              
              // Mesajları processBatch metoduna gönder
              await this.processBatch(messagesToProcess, client);
            }
          } catch (error) {
            logWorker.error(`Error processing ${folder} folder:`, error);
            // Continue with next folder even if current one fails
            continue;
          }
        }

        resolve();
      });
      this.imap.connect();
    });
  }

  public async processEmails(): Promise<void> {
    let client = null;

    try {
      // Zaten çalışıyorsa atla
      if (this.isProcessing) {
        logWorker.start('Another process is already running, skipping...');
        return;
      }

      this.isProcessing = true;

      // Veritabanı bağlantısı
      if (!pool) {
        throw new Error('Database connection pool not initialized');
      }

      client = await pool.connect();
      if (!client) {
        throw new Error('Failed to acquire database client');
      }
      logWorker.success('Connected to database');

      // IMAP bağlantısı
      if (!this.imap) {
        this.imap = new Imap({
          user: process.env.EMAIL || '',
          password: process.env.EMAIL_PASSWORD || '',
          host: process.env.IMAP_HOST || '',
          port: 993,
          tls: true,
          tlsOptions: { rejectUnauthorized: false }
        });
      }

      await this.connect();
      
      // E-postaları işle
      await this.processMailbox(client);

    } catch (error) {
      logWorker.error('Error in processEmails:', error);
    } finally {
      // Bağlantıları kapat
      if (client) {
        client.release();
        logWorker.success('Database connection released');
      }
      
      this.disconnect();
      this.isProcessing = false;
    }
  }
}