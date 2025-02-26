import fetch from 'node-fetch';
import { PoolClient } from 'pg';
import { isRobotPOSEmail } from '../utils/email.utils';
import { ParsedMail } from 'mailparser';
import { encodeEmailId } from '../emailIdEncoder';
import { retry } from '../utils/retry';

interface FlowResponse {
  success: boolean;
  flowId?: string;
  error?: string;
}

interface ActivityData {
  // activity data
}

export class FlowService {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000; // 1 second
  private static readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  private static getFlowEndpoint(emailData: ParsedMail): string {
    return isRobotPOSEmail(emailData.from?.text) ? '/api/send-to-flow' : '/api/send-email-to-flow';
  }

  private static getBaseUrl(): string {
    return process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  static async sendToFlow(client: PoolClient, emailId: number, emailData: ParsedMail): Promise<boolean> {
    const endpoint = this.getFlowEndpoint(emailData);
    const baseUrl = this.getBaseUrl();

    // Check if email was already sent to Flow
    const result = await client.query(
      'SELECT senttoflow FROM emails WHERE id = $1',
      [emailId]
    );

    if (result.rows[0]?.senttoflow) {
      console.log(`[FLOW] Email #${emailId} was already sent to Flow, skipping...`);
      return true;
    }

    try {
      console.log(`[FLOW] Sending email #${emailId} to Flow via ${baseUrl}${endpoint}`, {
        isFromRobotPOS: isRobotPOSEmail(emailData.from?.text),
        subject: emailData.subject,
        from: emailData.from?.text
      });

      // Get attachments from database
      const attachmentsResult = await client.query(
        'SELECT id, filename, storage_path FROM attachments WHERE email_id = $1',
        [emailId]
      );

      // Create public URLs for attachments
      const attachments = attachmentsResult.rows.map(attachment => {
        // Storage path'i düzelt
        const storagePath = attachment.storage_path;
        
        // Public URL'yi oluştur
        let publicUrl;
        if (process.env.WORKER_MODE === '1') {
          // Worker mode'da Next.js sunucusunun public URL'sini kullan
          publicUrl = `${baseUrl}/attachments/${storagePath}`;
        } else {
          // Normal modda API endpoint'ini kullan
          publicUrl = `${baseUrl}/api/attachments/${storagePath}`;
        }

        console.log(`[FLOW] Attachment public URL for ${attachment.filename}: ${publicUrl}`);

        return {
          id: attachment.id,
          filename: attachment.filename,
          storage_path: storagePath,
          public_url: publicUrl,
          FILE_NAME: attachment.filename,
          LINK: publicUrl
        };
      });

      // Create attachments section if there are any attachments
      let attachmentsHtml = '';
      if (attachments.length > 0) {
        attachmentsHtml = `
<div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
  <h3 style="color: #333;">📎 Ekler:</h3>
  <ul style="list-style: none; padding: 0;">
    ${attachments.map(att => `
      <li style="margin: 5px 0;">
        <a href="${att.public_url}" style="color: #0066cc; text-decoration: none;">
          📄 ${att.filename}
        </a>
      </li>
    `).join('')}
  </ul>
</div>`;
      }

      // Create email history link
      const encodedEmailId = encodeEmailId(emailId);
      const historyUrl = `${baseUrl}/email/${encodedEmailId}`;

      // Combine email body HTML with history link and attachments
      const descriptionWithExtras = `${attachmentsHtml}${emailData.html || emailData.text || ''}

<p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
  <a href="${historyUrl}" style="color: #0066cc; text-decoration: none;">📧 Mail Geçmişini Görüntüle</a>
</p>`;

      // Extract phone number from email body
      const phoneNumberMatch = emailData.text?.match(/Tel No:([^\n]*)/);
      const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1].trim() : '';
      const phoneNumberUrl = phoneNumber ? `bx://v2/crm.robotpos.com/phone/number/${phoneNumber}` : '';

      // Extract voice recording link from email body
      const voiceRecordingMatch = emailData.text?.match(/Ses Kaydı:.*\n?\[([^\]]+)\]/s);
      const voiceRecordingLink = voiceRecordingMatch ? voiceRecordingMatch[1].trim() : '';

      // Prepare request body based on endpoint
      let requestBody;
      const isRobotPOSMail = isRobotPOSEmail(emailData.from?.text);
      
      if (isRobotPOSMail) {
        requestBody = {
          email: {
            id: emailId,
            subject: emailData.subject,
            body_text: emailData.text,
            body_html: descriptionWithExtras,
            from_address: emailData.from?.text,
            headers: emailData.headers,
            attachments: attachments
          }
        };
      } else {
        requestBody = {
          email: {
            id: emailId,
            subject: emailData.subject,
            body_text: emailData.text || '',
            body_html: descriptionWithExtras,
            from_address: emailData.from?.text,
            to_addresses: emailData.to?.text ? [emailData.to.text] : [],
            cc_addresses: emailData.cc?.text ? [emailData.cc.text] : [],
            received_date: emailData.date?.toISOString() || new Date().toISOString(),
            headers: emailData.headers,
            attachments: attachments
          }
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        console.error(`[FLOW] Request timeout for email #${emailId} after ${this.REQUEST_TIMEOUT}ms`);
      }, this.REQUEST_TIMEOUT);

      const flowResponse = await retry(
        async () => {
          const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-worker-token': process.env.WORKER_API_TOKEN || ''
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Flow API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json();

          if (data?.success) {
            return {
              success: true
            };
          } else {
            throw new Error(`Invalid response from Flow API: ${JSON.stringify(data)}`);
          }
        },
        this.MAX_RETRIES,
        this.RETRY_DELAY
      );

      clearTimeout(timeout);

      if (flowResponse.success) {
        // Update email status in database - parent transaction içinde
        await client.query(
          'UPDATE emails SET senttoflow = true WHERE id = $1',
          [emailId]
        );

        console.log(`[FLOW] ✓ Email #${emailId} sent to Flow successfully`);
        return true;
      }

      return false;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`[FLOW] Request aborted for email #${emailId} due to timeout`);
      } else {
        console.error(`[FLOW] ✗ Error sending email #${emailId} to Flow:`, error);
      }
      throw error; // Parent transaction'da handle edilecek
    }
  }
}