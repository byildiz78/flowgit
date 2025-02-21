import { PoolClient } from 'pg';
import { ParsedMail } from 'mailparser';
import { FlowService } from './flow.service';
import { isRobotPOSEmail, generateDeterministicMessageId } from '../utils/email.utils';

export class EmailService {
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
          parsed.html || null,
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

      if (process.env.autosenttoflow === '1' && emailId) {
        try {
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