import fetch from 'node-fetch';
import { PoolClient } from 'pg';
import { isRobotPOSEmail } from '../utils/email.utils';
import { ParsedMail } from 'mailparser';
import { encodeEmailId } from '../emailIdEncoder';

export class FlowService {
  private static getFlowEndpoint(emailData: ParsedMail): string {
    return isRobotPOSEmail(emailData.from?.text) ? '/api/send-to-flow' : '/api/send-email-to-flow';
  }

  private static getBaseUrl(): string {
    return process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  static async sendToFlow(client: PoolClient, emailId: number, emailData: ParsedMail): Promise<void> {
    const endpoint = this.getFlowEndpoint(emailData);
    const baseUrl = this.getBaseUrl();

    // Check if email was already sent to Flow
    const result = await client.query(
      'SELECT senttoflow FROM emails WHERE id = $1',
      [emailId]
    );

    if (result.rows[0]?.senttoflow) {
      console.log(`[FLOW] Email #${emailId} was already sent to Flow, skipping...`);
      return;
    }

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

    try {
      console.log(`[FLOW] Sending email #${emailId} to Flow via ${baseUrl}${endpoint}`, {
        isFromRobotPOS: isRobotPOSMail,
        subject: emailData.subject,
        from: emailData.from?.text,
        attachmentCount: attachments.length
      });

      const flowResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-token': process.env.WORKER_API_TOKEN || ''
        },
        body: JSON.stringify(requestBody)
      });

      if (!flowResponse.ok) {
        let errorDetails;
        try {
          const errorText = await flowResponse.text();
          errorDetails = JSON.parse(errorText);
        } catch (parseError) {
          errorDetails = {
            status: flowResponse.status,
            statusText: flowResponse.statusText,
            response: {
              error: 'Failed to parse response JSON',
              rawText: 'Unable to get response text'
            }
          };
        }
        throw new Error(JSON.stringify(errorDetails));
      }

      // Update email status in database
      await client.query(
        'UPDATE emails SET senttoflow = true WHERE id = $1',
        [emailId]
      );

      console.log(`[FLOW] ✓ Email #${emailId} sent to Flow successfully`);

      // Send activity to Flow
      const activityData = {
        // activity data
      };
      const FLOW_ACTIVITY_API_URL = `${baseUrl}/api/activities`;
      const activityResponse = await fetch(FLOW_ACTIVITY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-token': process.env.WORKER_API_TOKEN || ''
        },
        body: JSON.stringify(activityData)
      });

      if (!activityResponse.ok) {
        throw new Error(`Flow Activity API error: ${activityResponse.status}`);
      }

    } catch (error) {
      console.error(`[FLOW] ✗ Failed to send email #${emailId} to Flow:`, error);
      throw error;
    }
  }
}