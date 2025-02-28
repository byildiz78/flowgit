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
  private flowRateLimit: number = 2000; // 2 saniye delay
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

    const messagesToProcess: { msg: any; seqno: number; attrs: any }[] = [];

    await new Promise<void>((resolve, reject) => {
      fetch.on('message', (msg, seqno) => {
        const messageInfo = { msg, seqno, attrs: null };
        
        msg.once('attributes', (attrs) => {
          logWorker.start(`Message #${seqno} flags: ${attrs.flags}`);
          messageInfo.attrs = attrs;
        });
        
        messagesToProcess.push(messageInfo);
      });

      fetch.once('error', (err) => {
        logWorker.error('Error during fetch:', err);
        reject(err);
      });

      fetch.once('end', () => {
        resolve();
      });
    });

    logWorker.start(`Processing ${messagesToProcess.length} emails sequentially`);
    for (const messageInfo of messagesToProcess) {
      try {
        const { msg, seqno, attrs } = messageInfo;
        
        if (!attrs || !attrs.uid) {
          logWorker.error(`Message attributes or UID not available for message #${seqno}, skipping...`);
          continue;
        }

        const uid = attrs.uid;
        const flags = attrs.flags || [];
        
        if (flags.includes('\\Deleted')) {
          logWorker.email.skip(uid, 'already marked for deletion');
          continue;
        }

        const parsed = await new Promise((resolve, reject) => {
          let bodyReceived = false;
          
          msg.on('body', async (stream) => {
            if (bodyReceived) return; 
            bodyReceived = true;
            
            try {
              const parsedMail = await simpleParser(stream);
              resolve(parsedMail);
            } catch (error) {
              reject(error);
            }
          });
          
          msg.once('error', (err) => {
            reject(err);
          });
        });

        logWorker.email.start(uid);
        await EmailService.processEmail(client, uid, parsed);
        
        await this.deleteEmail(uid);
        logWorker.email.success(uid);
        
        if (process.env.autosenttoflow === '1') {
          await delay(this.flowRateLimit);
        }
        
      } catch (error) {
        logWorker.error('Error processing email:', error);
      }
    }
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

      logWorker.start('Listing all mailboxes...');
      const boxes = await getBoxes();
      logWorker.success('Available mailboxes:', Object.keys(boxes));

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

          for (let i = 0; i < unprocessedEmails.length; i += this.batchSize) {
            const batch = unprocessedEmails.slice(i, i + this.batchSize);
            logWorker.start(`Processing batch ${i / this.batchSize + 1} of ${Math.ceil(unprocessedEmails.length / this.batchSize)}`);
            await this.processBatch(batch, client);
          }
        } catch (error) {
          logWorker.error(`Error processing ${folder} folder:`, error);
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