import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { promisify } from 'util';
import pool from './db';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import fetch from 'node-fetch';
import { createHash } from 'crypto';

const imapConfig = {
  user: process.env.EMAIL,
  password: process.env.EMAIL_PASSWORD,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT || '993'),
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  keepalive: true,
  debug: console.log,
  authTimeout: 3000
};

// Create attachments directory in public folder
const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'public', 'attachments');

export class EmailProcessor {
  private imap: Imap;
  private activeFlowSends: Set<number> = new Set(); // Track active sends by email ID

  constructor() {
    if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD || !process.env.IMAP_HOST) {
      throw new Error('Missing required IMAP configuration');
    }

    this.imap = new Imap(imapConfig);

    this.imap.on('error', (err) => {
      console.error('[IMAP ERROR] Connection error:', err);
    });

    // Ensure attachments directory exists
    mkdir(ATTACHMENTS_DIR, { recursive: true }).catch(error => {
      console.error('[IMAP ERROR] Failed to create attachments directory:', error);
    });
  }

  private async connect() {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        resolve();
      });
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  private async disconnect() {
    return new Promise<void>((resolve) => {
      this.imap.once('end', () => {
        resolve();
      });
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

  private isRobotPOSEmail(fromText: string | undefined): boolean {
    if (!fromText) return false;
    
    // Normalize the email address by converting to lowercase and removing extra spaces
    const normalizedFrom = fromText.toLowerCase().trim();
    
    // Log the from address for debugging
    console.log(`[FLOW] Checking if email is from RobotPOS. From address: "${normalizedFrom}"`);
    
    // Check both formats: with display name and without
    const isRobotPOS = normalizedFrom === '"robotpos" <robotpos.noreply@robotpos.com>' || 
                       normalizedFrom === 'robotpos.noreply@robotpos.com';
    
    return isRobotPOS;
  }

  private async sendToFlow(client: any, emailId: number, emailData: any): Promise<void> {
    // Transaction başlat
    await client.query('BEGIN');

    try {
      // Transaction içinde success kaydı var mı kontrol et
      const historyCheck = await client.query(
        `SELECT id, status, details::text as details_json 
         FROM email_history 
         WHERE email_id = $1 AND status = 'success'::email_status
         FOR UPDATE SKIP LOCKED`,
        [emailId]
      );

      if (historyCheck.rows.length > 0) {
        const details = JSON.parse(historyCheck.rows[0].details_json || '{}');
        console.log(`[FLOW] Email #${emailId} was already successfully sent to Flow`, {
          historyId: historyCheck.rows[0].id,
          sentAt: details.timestamp,
          flowId: details.flowResponse?.data?.result?.item?.id
        });
        await client.query('COMMIT');
        return;
      }

      // Flow endpoint'ini belirle
      const isFromRobotPOS = this.isRobotPOSEmail(emailData.from?.text);
      const endpoint = isFromRobotPOS ? '/api/send-to-flow' : '/api/send-email-to-flow';

      // Request body hazırla
      const requestBody = {
        email: {
          id: emailId,
          subject: emailData.subject,
          body_text: emailData.text,
          from_address: emailData.from?.text,
          headers: emailData.headers
        }
      };

      // Host ve protokol bilgilerini al
      const host = process.env.HOST || 'localhost:3000';
      const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
      const baseUrl = `${protocol}://${host}`;

      console.log(`[FLOW] Sending email #${emailId} to Flow via ${baseUrl}${endpoint}`, {
        isFromRobotPOS,
        subject: emailData.subject,
        from: emailData.from?.text
      });

      // İşlemi history'e kaydet (processing durumunda)
      await client.query(
        `INSERT INTO email_history (email_id, status, message, details)
         VALUES ($1, $2::email_status, $3, $4::jsonb)`,
        [
          emailId,
          'processing',
          'Sending to Flow',
          JSON.stringify({
            endpoint,
            requestBody,
            timestamp: new Date().toISOString()
          })
        ]
      );

      // Flow'a gönder
      const flowResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const responseData = await flowResponse.json().catch(async (e) => ({
        error: 'Failed to parse response JSON',
        rawText: await flowResponse.text().catch(() => 'Unable to get response text')
      }));

      if (!flowResponse.ok) {
        throw new Error(JSON.stringify({
          status: flowResponse.status,
          statusText: flowResponse.statusText,
          response: responseData
        }));
      }

      try {
        // Başarılı gönderimi history'e kaydet
        await client.query(
          `INSERT INTO email_history (email_id, status, message, details)
           VALUES ($1, $2::email_status, $3, $4::jsonb)
           ON CONFLICT (email_id) WHERE status = 'success'::email_status
           DO NOTHING`,
          [
            emailId,
            'success',
            'Successfully sent to Flow',
            JSON.stringify({
              endpoint,
              flowResponse: responseData,
              timestamp: new Date().toISOString()
            })
          ]
        );

        // Success kaydı yapılabildiyse commit
        const successCheck = await client.query(
          `SELECT id FROM email_history 
           WHERE email_id = $1 AND status = 'success'::email_status`,
          [emailId]
        );

        if (successCheck.rows.length === 0) {
          throw new Error('Another process has already sent this email to Flow');
        }

        await client.query('COMMIT');

        console.log(`[FLOW] Successfully sent email #${emailId} to Flow via ${endpoint}`, {
          flowId: responseData?.data?.result?.item?.id,
          status: 'success'
        });

      } catch (insertError) {
        // Success kaydı yapılamadıysa rollback
        await client.query('ROLLBACK');
        console.log(`[FLOW] Email #${emailId} was sent to Flow by another process`);
        return;
      }

    } catch (error) {
      await client.query('ROLLBACK');
      
      // Hatayı history'e kaydet (yeni transaction içinde)
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO email_history (email_id, status, message, details)
           VALUES ($1, $2::email_status, $3, $4::jsonb)`,
          [
            emailId,
            'error',
            error instanceof Error ? error.message : 'Unknown error',
            JSON.stringify({
              error: error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
              } : error,
              timestamp: new Date().toISOString()
            })
          ]
        );
        await client.query('COMMIT');
      } catch (historyError) {
        await client.query('ROLLBACK');
        console.error(`[FLOW ERROR] Failed to save error history for email #${emailId}:`, historyError);
      }

      console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, error);
      throw error;
    }
  }

  private async processEmail(client: any, uid: number, parsed: any): Promise<void> {
    if (!parsed.messageId) {
      console.error(`[DB ERROR] Message ID is missing for UID ${uid}, skipping processing`);
      return;
    }

    let emailId: number | null = null;

    try {
      // 1. Advisory lock al
      const lockId = Math.abs(Buffer.from(parsed.messageId).reduce((a, b) => a + b, 0));
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

      // 2. Mail daha önce işlenmiş mi kontrol et
      const existingEmail = await client.query(
        'SELECT id, imap_uid FROM emails WHERE message_id = $1 FOR UPDATE',
        [parsed.messageId]
      );

      if (existingEmail.rows.length > 0) {
        emailId = existingEmail.rows[0].id;
        const existingUid = existingEmail.rows[0].imap_uid;

        if (existingUid !== uid) {
          console.warn(`[DB WARNING] Email with message_id ${parsed.messageId} already exists with different UID (existing: ${existingUid}, new: ${uid})`);
        }

        console.log(`[DB] Email with message_id ${parsed.messageId} already exists (ID: ${emailId}), skipping insert`);
        await client.query('COMMIT');
        return;
      }

      // 3. Önce IMAP flag'i set et (DB transaction içinde)
      try {
        await this.addFlag(uid);
        console.log(`[IMAP] Successfully flagged email UID ${uid}`);
      } catch (flagError) {
        console.error(`[IMAP ERROR] Failed to flag email UID ${uid}:`, flagError);
        await client.query('ROLLBACK');
        throw flagError;
      }

      // 4. Flag başarılı olduysa maili ekle
      const emailResult = await client.query(
        `INSERT INTO emails (
          message_id, from_address, to_addresses, cc_addresses,
          subject, body_text, body_html, received_date, imap_uid,
          flagged
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        ON CONFLICT (message_id) DO NOTHING
        RETURNING id`,
        [
          parsed.messageId,
          parsed.from?.text || null,
          parsed.to?.text ? [parsed.to.text] : [],
          parsed.cc?.text ? [parsed.cc.text] : [],
          parsed.subject || null,
          parsed.text || null,
          parsed.html || null,
          parsed.date || new Date(),
          uid,
          true // Flag durumunu da kaydet
        ]
      );

      if (!emailResult.rows.length) {
        const retryCheck = await client.query(
          'SELECT id FROM emails WHERE message_id = $1',
          [parsed.messageId]
        );
        
        if (retryCheck.rows.length > 0) {
          emailId = retryCheck.rows[0].id;
          console.log(`[DB] Email was concurrently inserted, found existing ID: ${emailId}`);
        } else {
          throw new Error(`Failed to insert or find email with message_id ${parsed.messageId}`);
        }
      } else {
        emailId = emailResult.rows[0].id;
        console.log(`[DB] Successfully inserted new email with ID: ${emailId}`);
      }

      // 5. Transaction'ı commit et
      await client.query('COMMIT');

      // 6. Flow'a gönder (transaction dışında)
      if (process.env.autosenttoflow === '1' && emailId) {
        try {
          await this.sendToFlow(client, emailId, parsed);
        } catch (flowError) {
          console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, flowError);
        }
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[DB ERROR] Failed to process email:', error);
      throw error;
    }
  }

  private async processEmails() {
    let client = null;
    let isProcessing = false;

    try {
      if (isProcessing) {
        console.log('[IMAP] Another process is already running, skipping...');
        return;
      }

      isProcessing = true;

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

      const fetch = this.imap.fetch(unprocessedEmails, { 
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
              // Flag durumunu logluyoruz
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

              // RobotPOS maili için özel message-ID oluşturma
              const isRobotPOSMail = parsed.from?.text === '"RobotPOS" <robotpos.noreply@robotpos.com>';
              if (isRobotPOSMail) {
                // Mail içeriğinden benzersiz bir hash oluştur
                const contentToHash = [
                  parsed.subject,
                  parsed.text,
                  parsed.from?.text,
                  parsed.date?.toISOString()
                ].join('|');

                const hash = createHash('sha256')
                  .update(contentToHash)
                  .digest('hex')
                  .substring(0, 32); // İlk 32 karakteri al

                // Telefon numarasını subject'ten çıkar
                const phoneMatch = parsed.subject?.match(/#\+?(\d+)#/);
                const phone = phoneMatch ? phoneMatch[1] : 'unknown';
                
                // Tarih bilgisini al
                const timestamp = parsed.date?.getTime() || Date.now();

                // Deterministik message-ID oluştur
                parsed.messageId = `<robotpos-${phone}-${timestamp}-${hash}@local>`;
                
                console.log(`[IMAP DEBUG] Generated deterministic message-id for RobotPOS mail:`, {
                  uid,
                  messageId: parsed.messageId,
                  subject: parsed.subject,
                  phone,
                  timestamp,
                  hash
                });
              }

              // Flag durumunu kontrol et
              const flags = messageAttributes.flags || [];
              if (flags.includes('\\Flagged')) {
                console.log(`[IMAP] Skipping message #${seqno} (UID: ${uid}) as it's already flagged`);
                resolveProcess();
                return;
              }

              await this.processEmail(client, uid, parsed);
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

      // Fetch tamamlandığında tüm mailleri sırayla işle
      await new Promise<void>((resolve, reject) => {
        fetch.once('end', async () => {
          try {
            console.log(`[IMAP] Processing ${processPromises.length} emails sequentially`);
            // Mailleri sırayla işle
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

    } catch (error) {
      console.error('[IMAP ERROR] Error in email processing:', error);
      throw error;
    } finally {
      isProcessing = false;
      if (client) {
        try {
          await client.query('ROLLBACK').catch(console.error); // Eğer açık transaction varsa rollback yap
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