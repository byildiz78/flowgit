import { PoolClient } from 'pg';
import { ParsedMail, Attachment } from 'mailparser';
import { FlowService } from './flow.service';
import { isRobotPOSEmail, generateDeterministicMessageId } from '../utils/email.utils';
import { promises as fs } from 'fs';
import path from 'path';

export class EmailService {
  private static async saveAttachment(client: PoolClient, emailId: number, attachment: Attachment): Promise<void> {
    try {
      const filename = attachment.filename || 'unnamed_attachment';
      const contentType = attachment.contentType;
      const content = attachment.content;
      
      // Dosya adını güvenli hale getir
      const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      // Proje kök dizinini bul ve attachments klasörünü oluştur
      const projectRoot = process.cwd();
      const attachmentsDir = path.join(projectRoot, 'public', 'attachments');
      const storagePath = path.join(attachmentsDir, `${emailId}_${safeFilename}`);
      
      console.log(`[ATTACHMENT DEBUG] Mode: ${process.env.WORKER_MODE === '1' ? 'worker' : 'normal'}`);
      console.log(`[ATTACHMENT DEBUG] Project root: ${projectRoot}`);
      console.log(`[ATTACHMENT DEBUG] Attachments directory: ${attachmentsDir}`);
      console.log(`[ATTACHMENT DEBUG] Attempting to save file to: ${storagePath}`);
      console.log(`[ATTACHMENT DEBUG] File content type: ${contentType}`);
      console.log(`[ATTACHMENT DEBUG] File size: ${content.length} bytes`);
      
      // Klasörün varlığını kontrol et ve oluştur
      try {
        await fs.mkdir(attachmentsDir, { recursive: true });
        console.log(`[ATTACHMENT DEBUG] Directory ${attachmentsDir} checked/created successfully`);
      } catch (error) {
        console.error(`[ATTACHMENT ERROR] Failed to create directory ${attachmentsDir}:`, error);
        throw error;
      }
      
      // Dosyayı kaydet
      try {
        console.log(`[ATTACHMENT DEBUG] Writing file content to: ${storagePath}`);
        await fs.writeFile(storagePath, content);
        console.log(`[ATTACHMENT DEBUG] File written successfully to: ${storagePath}`);
      } catch (error) {
        console.error(`[ATTACHMENT ERROR] Failed to save file ${storagePath} for email #${emailId}:`, error);
        throw new Error(`Failed to save attachment file: ${error.message}`);
      }
      
      // Veritabanına kaydet
      await client.query(
        `INSERT INTO attachments (
          email_id, filename, content_type, size, storage_path
        ) VALUES ($1, $2, $3, $4, $5)`,
        [emailId, filename, contentType, content.length, path.basename(storagePath)]
      );
      
      console.log(`[ATTACHMENT] Saved attachment ${filename} for email #${emailId}`);
    } catch (error) {
      console.error(`[ATTACHMENT ERROR] Failed to save attachment for email #${emailId}:`, error);
      throw error;
    }
  }

  static async processEmail(client: PoolClient, uid: number, parsed: ParsedMail): Promise<void> {
    let emailId: number | null = null;

    try {
      // RobotPOS maili için özel message-ID oluştur
      if (isRobotPOSEmail(parsed.from?.text)) {
        parsed.messageId = generateDeterministicMessageId(parsed);
      } else if (!parsed.messageId) {
        console.error(`[DB ERROR] Message ID is missing for UID ${uid}, skipping processing`);
        return;
      }

      // İlk olarak message_id için lock al
      const lockId = Math.abs(Buffer.from(parsed.messageId).reduce((a, b) => a + b, 0));
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

      // Mail daha önce işlenmiş mi kontrol et
      const existingEmail = await client.query(
        'SELECT id, imap_uid FROM emails WHERE message_id = $1 FOR UPDATE NOWAIT',
        [parsed.messageId]
      );

      if (existingEmail.rows.length > 0) {
        emailId = existingEmail.rows[0].id;
        const existingUid = existingEmail.rows[0].imap_uid;

        if (existingUid !== uid) {
          console.warn(`[DB WARNING] Email with message_id ${parsed.messageId} already exists with different UID (existing: ${existingUid}, new: ${uid})`);
        }

        console.log(`[DB] Email with message_id ${parsed.messageId} already exists (ID: ${emailId}), skipping insert`);
        
        // Var olan mail için de Flow'a gönderim yap
        if (process.env.autosenttoflow === '1' && emailId) {
          try {
            // Add a delay before sending to Flow to ensure emails are not sent simultaneously
            const flowSendDelay = 4000; // 4 seconds
            console.log(`[EMAIL SERVICE] Adding ${flowSendDelay}ms delay before sending email #${emailId} to Flow...`);
            await new Promise(resolve => setTimeout(resolve, flowSendDelay));
            
            await FlowService.sendToFlow(client, emailId, parsed);
          } catch (flowError) {
            console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, flowError);
          }
        }
        
        await client.query('COMMIT');
        return;
      }

      // Mail ekle veya güncelle
      const emailResult = await client.query(
        `INSERT INTO emails (
          message_id, from_address, to_addresses, cc_addresses,
          subject, body_text, body_html, received_date, imap_uid,
          flagged
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        ON CONFLICT (message_id) DO UPDATE SET
          imap_uid = EXCLUDED.imap_uid,
          flagged = EXCLUDED.flagged
        RETURNING id`,
        [
          parsed.messageId,
          parsed.from?.text || null,
          parsed.to?.text ? [parsed.to.text] : [],
          parsed.cc?.text ? [parsed.cc.text] : [],
          parsed.subject || null,
          parsed.text || null,
          parsed.textAsHtml || null,
          parsed.date || new Date(),
          uid,
          true
        ]
      );

      if (!emailResult.rows.length) {
        throw new Error(`Failed to insert/update email with message_id ${parsed.messageId}`);
      }

      emailId = emailResult.rows[0].id;
      console.log(`[DB] Successfully processed email with ID: ${emailId}`);

      // Attachmentları kaydet
      if (parsed.attachments && parsed.attachments.length > 0) {
        console.log(`[ATTACHMENT] Processing ${parsed.attachments.length} attachments for email #${emailId}`);
        for (const attachment of parsed.attachments) {
          await this.saveAttachment(client, emailId, attachment);
        }
      }

      if (process.env.autosenttoflow === '1' && emailId) {
        try {
          // Add a delay before sending to Flow to ensure emails are not sent simultaneously
          const flowSendDelay = 4000; // 4 seconds
          console.log(`[EMAIL SERVICE] Adding ${flowSendDelay}ms delay before sending email #${emailId} to Flow...`);
          await new Promise(resolve => setTimeout(resolve, flowSendDelay));
          
          await FlowService.sendToFlow(client, emailId, parsed);
        } catch (flowError) {
          console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, flowError);
        }
      }

      await client.query('COMMIT');

    } catch (error) {
      if (error.code === '55P03') { // Lock alınamadı hatası
        console.log(`[DB] Email with message_id ${parsed.messageId} is being processed by another transaction, skipping`);
        await client.query('ROLLBACK');
        return;
      }
      
      await client.query('ROLLBACK');
      console.error('[DB ERROR] Failed to process email:', error);
      throw error;
    }
  }
}