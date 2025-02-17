import fetch from 'node-fetch';
import { PoolClient } from 'pg';
import { isRobotPOSEmail } from '../utils/email.utils';
import { ParsedMail } from 'mailparser';

export class FlowService {
  private static getFlowEndpoint(emailData: ParsedMail): string {
    return isRobotPOSEmail(emailData.from?.text) ? '/api/send-to-flow' : '/api/send-email-to-flow';
  }

  private static getBaseUrl(): string {
    const host = process.env.HOST || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  static async sendToFlow(client: PoolClient, emailId: number, emailData: ParsedMail): Promise<void> {
    await client.query('BEGIN');

    try {
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
          flowId: details.flowResponse?.result?.item?.id?.toString()
        });
        await client.query('COMMIT');
        return;
      }

      const endpoint = this.getFlowEndpoint(emailData);
      const requestBody = {
        email: {
          id: emailId,
          subject: emailData.subject,
          body_text: emailData.text,
          from_address: emailData.from?.text,
          headers: emailData.headers
        }
      };

      const baseUrl = this.getBaseUrl();

      console.log(`[FLOW] Sending email #${emailId} to Flow via ${baseUrl}${endpoint}`, {
        isFromRobotPOS: isRobotPOSEmail(emailData.from?.text),
        subject: emailData.subject,
        from: emailData.from?.text
      });

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
        await client.query(
          `INSERT INTO email_history (email_id, status, message, details)
           VALUES ($1, $2::email_status, $3, $4::jsonb)
           ON CONFLICT (email_id) 
           DO UPDATE SET 
             status = EXCLUDED.status,
             message = EXCLUDED.message,
             details = EXCLUDED.details,
             updated_at = CURRENT_TIMESTAMP
           WHERE email_history.status != 'success'::email_status`,
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

        const successCheck = await client.query(
          `SELECT id, status FROM email_history 
           WHERE email_id = $1 
           ORDER BY created_at DESC 
           LIMIT 1`,
          [emailId]
        );

        if (successCheck.rows.length === 0 || successCheck.rows[0].status !== 'success') {
          throw new Error('Failed to update email history status');
        }

        await client.query('COMMIT');

        console.log(`[FLOW] Successfully sent email #${emailId} to Flow via ${endpoint}`, {
          flowId: responseData?.result?.item?.id?.toString(),
          status: 'success'
        });

      } catch (insertError) {
        await client.query('ROLLBACK');
        console.error(`[FLOW] Failed to update history for email #${emailId}:`, insertError);
        throw insertError;
      }

    } catch (error) {
      await client.query('ROLLBACK');
      
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
}
