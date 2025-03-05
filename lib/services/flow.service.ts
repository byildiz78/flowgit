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
  // Add a static semaphore to limit concurrent API calls
  private static inProgressApiCalls = 0;
  private static MAX_CONCURRENT_API_CALLS = 2;

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
    // Wait if there are too many concurrent API calls
    while (FlowService.inProgressApiCalls >= FlowService.MAX_CONCURRENT_API_CALLS) {
      logWorker.warn(`Waiting for API call slot. Currently ${FlowService.inProgressApiCalls} calls in progress`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    FlowService.inProgressApiCalls++;
    
    try {
      const endpoint = this.getFlowEndpoint(emailData);
      const baseUrl = this.getBaseUrl();

      // Check if email was already sent to Flow
      const result = await client.query(
        'SELECT senttoflow FROM emails WHERE id = $1',
        [emailId]
      );

      if (result.rows[0]?.senttoflow) {
        logWorker.warn(`Email #${emailId} was already sent to Flow, skipping...`);
        return true;
      }

      logWorker.api.start(endpoint, { emailId, subject: emailData.subject });

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
        const publicBaseUrl = this.getPublicUrl(); // Dışarıdan erişilebilir URL kullan
        let publicUrl;
        if (process.env.WORKER_MODE === '1') {
          // Worker mode'da Next.js sunucusunun public URL'sini kullan
          publicUrl = `${publicBaseUrl}/attachments/${storagePath}`;
        } else {
          // Normal modda API endpoint'ini kullan
          publicUrl = `${publicBaseUrl}/api/attachments/${storagePath}`;
        }

        logWorker.start(`Created attachment URL for ${attachment.filename}: ${publicUrl}`);

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
      const historyUrl = `${this.getPublicUrl()}/email/${encodedEmailId}`;

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
      let requestBody: {
        email: {
          id: number;
          subject?: string;
          body_text?: string;
          body_html?: string;
          from_address?: string;
          to_addresses?: string[];
          cc_addresses?: string[];
          received_date?: string;
          headers?: any;
          attachments?: any[];
        }
      };
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
            to_addresses: emailData.to ? (Array.isArray(emailData.to) ? emailData.to.map(a => a.text) : [emailData.to.text]) : [],
            cc_addresses: emailData.cc ? (Array.isArray(emailData.cc) ? emailData.cc.map(a => a.text) : [emailData.cc.text]) : [],
            received_date: emailData.date?.toISOString() || new Date().toISOString(),
            headers: emailData.headers,
            attachments: attachments
          }
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        logWorker.error(`Request timeout for email #${emailId} after ${this.REQUEST_TIMEOUT}ms`);
      }, this.REQUEST_TIMEOUT);

      const flowResponse = await retry<{ success?: boolean; flowId?: string; error?: string }>(
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

          // Gönderilen verilerde destek@robotpos.com adresi var mı detaylı log tut
          if (process.env.detaillog === '1') {
            // To ve CC adreslerini kontrol et
            const toAddresses = requestBody.email?.to_addresses || [];
            const ccAddresses = requestBody.email?.cc_addresses || [];
            
            const toHasSupportEmail = toAddresses.some(addr => 
              typeof addr === 'string' && addr.toLowerCase().includes('destek@robotpos.com'));
            const ccHasSupportEmail = ccAddresses.some(addr => 
              typeof addr === 'string' && addr.toLowerCase().includes('destek@robotpos.com'));
              
            if (toHasSupportEmail || ccHasSupportEmail) {
              logWorker.api.error(endpoint, {
                issue: 'Support email not filtered',
                emailId,
                toHasSupportEmail,
                ccHasSupportEmail,
                toAddresses,
                ccAddresses,
                requestData: {
                  ...requestBody,
                  // Sadece gerekli alanları logla
                  email: {
                    id: requestBody.email?.id,
                    to_addresses: requestBody.email?.to_addresses,
                    cc_addresses: requestBody.email?.cc_addresses
                  }
                }
              });
            }
          }

          if (!response.ok) {
            const errorText = await response.text();
            logWorker.error(`Flow API error: ${response.status} - ${errorText}`);
            
            // Detaylı API log için daha fazla bilgi ekle
            logWorker.api.error(endpoint, {
              status: response.status,
              statusText: response.statusText,
              errorText,
              emailId,
              requestData: requestBody
            });
            
            throw new Error(`Flow API error: ${response.status} - ${errorText}`);
          }

          const data = await response.json() as { 
            success?: boolean; 
            flowId?: string;
            error?: string;
          };

          if (data?.success) {
            logWorker.api.success(endpoint, { emailId, flowId: data.flowId, data });
            return data;
          } else {
            logWorker.error(`Invalid response from Flow API: ${JSON.stringify(data)}`);
            
            // Detaylı API log için daha fazla bilgi ekle
            logWorker.api.error(endpoint, {
              issue: 'Invalid response structure',
              emailId,
              response: data,
              requestData: requestBody
            });
            
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

        logWorker.success(`Email #${emailId} sent to Flow successfully`);
        return true;
      }

      return false;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logWorker.error(`Request aborted for email #${emailId} due to timeout`);
      } else {
        logWorker.error(`Error sending email #${emailId} to Flow:`, error);
      }
      throw error; // Parent transaction'da handle edilecek
    } finally {
      // Always decrement the counter when done, regardless of success or failure
      FlowService.inProgressApiCalls--;
    }
  }
}