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
      logWorker.api.start(endpoint, { 
        emailId, 
        subject: emailData.subject,
        from: emailData.from?.text,
        baseUrl: baseUrl,
        timestamp: new Date().toISOString()
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

      const requestBody = {
        emailId,
        subject: emailData.subject,
        from: emailData.from?.text,
        to: emailData.to?.text,
        cc: emailData.cc?.text,
        attachments: attachments,
      };

      logWorker.api.start(`${endpoint} request details`, {
        url: `${baseUrl}${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [REDACTED]'
        },
        body: requestBody
      });

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WORKER_API_TOKEN}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Flow API error: ${response.status} - ${errorText}`);
        (error as any).response = response;
        (error as any).responseText = errorText;
        throw error;
      }

      const data = await response.json();
      
      if (data?.success) {
        logWorker.api.success(endpoint, { 
          emailId, 
          flowId: data.flowId,
          responseStatus: response.status,
          timestamp: new Date().toISOString()
        });

        // Update database only on success
        await client.query(
          'UPDATE emails SET senttoflow = true WHERE id = $1',
          [emailId]
        );

        logWorker.success(`Email #${emailId} sent to Flow successfully`);
        return true;
      } else {
        throw new Error(`Invalid response from Flow API: ${JSON.stringify(data)}`);
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        logWorker.error(`Request aborted for email #${emailId} due to timeout`);
      } else {
        logWorker.api.error(endpoint, {
          emailId,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack,
            status: error.response?.status,
            responseText: error.responseText,
            timestamp: new Date().toISOString()
          }
        });
      }
      return false;
    }
  }
}