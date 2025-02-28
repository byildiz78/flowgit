import fetch from 'node-fetch';
import { PoolClient } from 'pg';
import { isRobotPOSEmail } from '../utils/email.utils';
import { ParsedMail } from 'mailparser';
import { encodeEmailId } from '../emailIdEncoder';
import { retry } from '../utils/retry';
import { logWorker } from '../utils/logger';

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
    const isRobot = isRobotPOSEmail(emailData.from?.text);
    const endpoint = isRobot ? '/api/send-to-flow' : '/api/send-email-to-flow';
    logWorker.start(`Using endpoint ${endpoint} for email from ${emailData.from?.text}`);
    return endpoint;
  }

  private static getBaseUrl(): string {
    // İç ağdan yapılan API çağrıları için NEXTAUTH_URL_INTERNAL kullanılır
    return process.env.NEXTAUTH_URL_INTERNAL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  private static getPublicUrl(): string {
    // Dışarıdan erişilebilir URL'ler için NEXTAUTH_URL kullanılır
    return process.env.NEXTAUTH_URL || 'http://localhost:3000';
  }

  static async sendToFlow(client: PoolClient, emailId: number, emailData: ParsedMail): Promise<boolean> {
    try {
      // Daha önce gönderilmiş mi kontrol et
      const existingCheck = await client.query(
        'SELECT senttoflow FROM emails WHERE id = $1',
        [emailId]
      );

      if (existingCheck.rows.length === 0) {
        console.error(`[FLOW ERROR] Email with ID ${emailId} not found in database`);
        return false;
      }

      if (existingCheck.rows[0].senttoflow) {
        console.log(`[FLOW] Email #${emailId} already sent to Flow, skipping`);
        return true;
      }

      // Ekler için sorgu
      const attachmentsResult = await client.query(
        'SELECT id, filename, storage_path FROM attachments WHERE email_id = $1',
        [emailId]
      );

      // Ekler için HTML oluştur
      let attachmentsHtml = '';
      const attachments = attachmentsResult.rows.map(attachment => {
        const storagePath = attachment.storage_path;
        const publicBaseUrl = this.getPublicUrl();
        let publicUrl;
        if (process.env.WORKER_MODE === '1') {
          publicUrl = `${publicBaseUrl}/attachments/${storagePath}`;
        } else {
          publicUrl = `${publicBaseUrl}/api/attachments/${storagePath}`;
        }

        // Ek için HTML oluştur
        attachmentsHtml += `<p style="margin-bottom: 10px;"><a href="${publicUrl}" style="color: #0066cc; text-decoration: none;" target="_blank">📎 ${attachment.filename}</a></p>`;

        return {
          id: attachment.id,
          filename: attachment.filename,
          storage_path: storagePath,
          public_url: publicUrl,
          FILE_NAME: attachment.filename,
          LINK: publicUrl
        };
      });

      // Mail geçmişi linki
      const baseUrl = this.getPublicUrl();
      const historyUrl = `${baseUrl}/emails/${emailId}`;

      // Açıklama metni oluştur
      const descriptionWithExtras = `${attachmentsHtml}${emailData.html || emailData.text || ''}
      <p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
        <a href="${historyUrl}" style="color: #0066cc; text-decoration: none;">📧 Mail Geçmişini Görüntüle</a>
      </p>`;

      // Endpoint belirle
      const endpoint = this.getFlowEndpoint(emailData);

      // İstek gövdesi oluştur
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

      // API isteği gönder
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        console.error(`[FLOW ERROR] Request timeout for email #${emailId} after ${this.REQUEST_TIMEOUT}ms`);
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

          clearTimeout(timeout);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
          }

          const result = await response.json();
          return { success: result.success, data: result.data };
        },
        this.MAX_RETRIES,
        this.RETRY_DELAY
      );

      // senttoflow alanını güncelleme kodu kaldırıldı
      // API endpoint'leri bu güncellemeyi yapacak

      return flowResponse.success;
    } catch (error) {
      console.error(`[FLOW ERROR] Failed to send email #${emailId} to Flow:`, error);
      return false;
    }
  }
}