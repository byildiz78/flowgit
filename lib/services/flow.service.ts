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

    try {
      // API isteği öncesi tüm verileri logla
      const requestData = {
        emailId,
        subject: emailData.subject,
        from: emailData.from?.text,
        to: emailData.to?.text,
        cc: emailData.cc?.text,
      };
      
      logWorker.api.start(endpoint, { 
        emailId, 
        subject: emailData.subject,
        requestData: JSON.stringify(requestData, null, 2)  // Tüm request verilerini logla
      });

      // Get attachments from database
      const attachmentsResult = await client.query(
        'SELECT id, filename, storage_path FROM attachments WHERE email_id = $1',
        [emailId]
      );

      // Create public URLs for attachments
      const attachments = attachmentsResult.rows.map(attachment => {
        const storagePath = attachment.storage_path;
        const publicBaseUrl = this.getPublicUrl();
        
        let publicUrl;
        if (process.env.WORKER_MODE === '1') {
          publicUrl = `${publicBaseUrl}/attachments/${storagePath}`;
        } else {
          publicUrl = `${publicBaseUrl}/api/attachments/${storagePath}`;
        }

        logWorker.start(`Created attachment URL for ${attachment.filename}: ${publicUrl}`);

        return {
          id: attachment.id,
          filename: attachment.filename,
          storage_path: storagePath,
          FILE_NAME: attachment.filename,
          FILE_URL: publicUrl
        };
      });

      // API isteği gönder
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WORKER_API_TOKEN}`
        },
        body: JSON.stringify({
          ...requestData,
          attachments
        })
      });

      // Response detaylarını logla
      const responseText = await response.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = responseText;
      }

      if (!response.ok) {
        logWorker.error(`Flow API error: ${response.status}`, { 
          endpoint,
          emailId,
          requestData,
          response: responseData
        });
        throw new Error(`Flow API error: ${response.status} - ${responseText}`);
      }

      logWorker.api.success(endpoint, { 
        emailId, 
        flowId: responseData.flowId,
        response: responseData
      });
      
      // Update email status in database - parent transaction içinde
      await client.query(
        'UPDATE emails SET senttoflow = true WHERE id = $1',
        [emailId]
      );

      logWorker.success(`Email #${emailId} sent to Flow successfully`);
      return true;
    } catch (error) {
      logWorker.api.error(endpoint, { 
        emailId, 
        error: error.message,
        stack: error.stack
      });
      throw error; // Parent transaction'da handle edilecek
    }
  }
}