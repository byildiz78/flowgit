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
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to save attachment file: ${errorMessage}`);
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

  // Extract phone number from subject following the pattern #+905452384472#
  static extractPhoneNumber(subject: string): string | null {
    if (!subject) return null;
    
    try {
      const phoneRegex = /#\+9[0-9]{10,12}#/;
      const match = subject.match(phoneRegex);
      return match ? match[0] : null;
    } catch (error) {
      console.error(`Error extracting phone number: ${error}`);
      return null;
    }
  }

  // Count how many times a phone number has appeared in subjects today
  private static async getPhoneNumberOccurrenceToday(client: PoolClient, phoneNumber: string): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const result = await client.query(
        `SELECT COUNT(*) as count FROM emails 
         WHERE subject LIKE $1 
         AND received_date >= $2`,
        [`%${phoneNumber}%`, today]
      );
      
      return parseInt(result.rows[0].count, 10) + 1; // Add 1 to include current email
    } catch (error) {
      console.error(`[DB ERROR] Failed to count phone number occurrences: ${error}`);
      return 1; // Default to 1 if there's an error
    }
  }

  // Modify subject to include occurrence count if a phone number is present
  private static async modifySubjectWithPhoneCount(client: PoolClient, subject: string): Promise<string> {
    const phoneNumber = this.extractPhoneNumber(subject);
    if (!phoneNumber) {
      return subject;
    }
    
    const count = await this.getPhoneNumberOccurrenceToday(client, phoneNumber);
    // Add a special marker #CALLCOUNT=X# that can be easily extracted later
    return `${subject} (${count} Kez) #CALLCOUNT=${count}#`;
  }

  static async processEmail(client: PoolClient, uid: number, parsed: ParsedMail): Promise<number | null> {
    let emailId: number | null = null;

    try {
      // RobotPOS maili için özel message-ID oluştur
      if (isRobotPOSEmail(parsed.from?.text)) {
        parsed.messageId = generateDeterministicMessageId(parsed);
      } else if (!parsed.messageId) {
        console.error(`[DB ERROR] Message ID is missing for UID ${uid}, skipping processing`);
        return null;
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
        
        // Veri tabanı işlemi bitince commit yap
        await client.query('COMMIT');
        
        // Flow'a gönderim artık burada yapılmıyor, IMAP silme işleminden sonra yapılacak
        return emailId;
      }

      // Modify subject if it contains a phone number pattern
      let modifiedSubject = parsed.subject || 'Konu Belirtilmedi';
      if (modifiedSubject && this.extractPhoneNumber(modifiedSubject)) {
        modifiedSubject = await this.modifySubjectWithPhoneCount(client, modifiedSubject);
        console.log(`[SUBJECT] Modified subject with phone count: ${modifiedSubject}`);
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
          parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text) : [parsed.to.text]) : [],
          parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(a => a.text) : [parsed.cc.text]) : [],
          modifiedSubject, // Use the potentially modified subject
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
      if (parsed.attachments && parsed.attachments.length > 0 && emailId !== null) {
        console.log(`[ATTACHMENT] Processing ${parsed.attachments.length} attachments for email #${emailId}`);
        for (const attachment of parsed.attachments) {
          await this.saveAttachment(client, emailId as number, attachment);
        }
      }
      
      // Veri tabanı işlemleri tamamlandı, commit yap
      await client.query('COMMIT');
      
      // Update parsed mail subject with the modified version for later Flow sending
      if (modifiedSubject !== parsed.subject) {
        parsed.subject = modifiedSubject;
      }
      
      // Flow'a gönderim artık burada yapılmıyor, IMAP silme işleminden sonra yapılacak
      return emailId;

    } catch (error) {
      // Check if error is a PostgreSQL error with a code property
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') { // Lock alınamadı hatası
        console.log(`[DB] Email with message_id ${parsed.messageId} is being processed by another transaction, skipping`);
        await client.query('ROLLBACK');
        return null;
      }
      
      await client.query('ROLLBACK');
      console.error('[DB ERROR] Failed to process email:', error);
      throw error;
    }
  }
  
  // Flow API'ye gönderim işlemini ayrı bir metoda taşıdık
  static async sendEmailToFlow(client: PoolClient, emailId: number, parsed: ParsedMail): Promise<void> {
    try {
      // Add a delay before sending to Flow to avoid concurrent API calls
      await new Promise(resolve => setTimeout(resolve, 1500)); // 500ms'den 1.5 saniyeye çıkarıyoruz
      await FlowService.sendToFlow(client, emailId, parsed);
    } catch (flowError) {
      console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, flowError);
      throw flowError;
    }
  }
}