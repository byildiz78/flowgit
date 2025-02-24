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
    const attachments = attachmentsResult.rows.map(attachment => ({
      id: attachment.id,
      filename: attachment.filename,
      storage_path: attachment.storage_path,
      public_url: `${baseUrl}/api/attachments/${attachment.storage_path}`
    }));

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
          body_html: emailData.html,
          from_address: emailData.from?.text,
          to_addresses: emailData.to?.text ? [emailData.to.text] : [],
          cc_addresses: emailData.cc?.text ? [emailData.cc.text] : [],
          received_date: emailData.date?.toISOString() || new Date().toISOString(),
          headers: emailData.headers,
          attachments: attachments
        }
      };
    }

    console.log(`[FLOW] Sending email #${emailId} to Flow via ${baseUrl}${endpoint}`, {
      isFromRobotPOS: isRobotPOSMail,
      subject: emailData.subject,
      from: emailData.from?.text,
      attachmentCount: attachments.length
    });

    const flowResponse = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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

    // Get Flow ID based on response type
    let flowId;
    if (isRobotPOSMail) {
      flowId = responseData?.data?.result?.item?.id;
    } else {
      flowId = responseData?.data?.flow?.result?.item?.id || responseData?.data?.flowId;
    }

    if (!flowId) {
      throw new Error('Flow ID not found in response: ' + JSON.stringify(responseData));
    }

    // Update email subject with Flow ID in database
    await client.query(
      `UPDATE emails 
       SET subject = $1, 
           senttoflow = true
       WHERE id = $2`,
      [
        emailData.subject?.includes('#FlowID=') ? emailData.subject : `${emailData.subject} #FlowID=${flowId}#`,
        emailId
      ]
    );

    console.log(`[FLOW] Successfully sent email #${emailId} to Flow via ${endpoint}`, {
      flowId: flowId.toString(),
      status: 'success'
    });
  }
}