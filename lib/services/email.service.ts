import { PoolClient } from 'pg';
import { ParsedMail } from 'mailparser';
import { FlowService } from './flow.service';
import { isRobotPOSEmail, generateDeterministicMessageId } from '../utils/email.utils';

export class EmailService {
  static async processEmail(client: PoolClient, uid: number, parsed: ParsedMail): Promise<void> {
    if (!parsed.messageId) {
      console.error(`[DB ERROR] Message ID is missing for UID ${uid}, skipping processing`);
      return;
    }

    let emailId: number | null = null;

    try {
      const lockId = Math.abs(Buffer.from(parsed.messageId).reduce((a, b) => a + b, 0));
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);

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

      if (isRobotPOSEmail(parsed.from?.text)) {
        parsed.messageId = generateDeterministicMessageId(parsed);
      }

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
          true
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

      await client.query('COMMIT');

      if (process.env.autosenttoflow === '1' && emailId) {
        try {
          await FlowService.sendToFlow(client, emailId, parsed);
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
}
