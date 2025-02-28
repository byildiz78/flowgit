import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encodeEmailId } from '@/lib/emailIdEncoder';
import { headers } from 'next/headers';

// Semaphore implementation to ensure only one API call is made to Flow at a time
class Semaphore {
  private static instance: Semaphore;
  private mutex = Promise.resolve();

  private constructor() {}

  public static getInstance(): Semaphore {
    if (!Semaphore.instance) {
      Semaphore.instance = new Semaphore();
    }
    return Semaphore.instance;
  }

  async acquire(): Promise<() => void> {
    let release: () => void = () => {};
    
    // Create a new mutex promise that resolves when the previous one is done
    const newMutex = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    
    // Wait for the current mutex to resolve before returning the release function
    const oldMutex = this.mutex;
    this.mutex = newMutex;
    
    await oldMutex;
    return release;
  }
}

const semaphore = Semaphore.getInstance();

const FLOW_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.add';
const FLOW_ACTIVITY_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.activity.add';

export async function POST(request: Request) {
  let client = null;
  let email = null;
  
  try {
    // Worker token kontrolü
    const headersList = headers();
    const workerToken = headersList.get('x-worker-token');
    const isWorkerRequest = workerToken === process.env.WORKER_API_TOKEN;

    if (!isWorkerRequest) {
      console.log('[FLOW API] Unauthorized request - missing or invalid worker token');
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized - Worker token required'
      }, { status: 401 });
    }

    const body = await request.json();
    email = body.email;

    // Check if email was already sent to Flow
    client = await pool.connect();
    const result = await client.query(
      'SELECT senttoflow FROM emails WHERE id = $1',
      [email.id]
    );

    if (result.rows[0]?.senttoflow) {
      return NextResponse.json({ 
        success: false, 
        error: 'Email was already sent to Flow'
      });
    }

    // Check if Flow ID already exists in the subject
    const flowIdMatch = email.subject.match(/#FlowID=(\d+)#/);
    let flowId = flowIdMatch ? flowIdMatch[1] : null;

    // Try to get email body in both text and HTML formats
    let emailBody = '';
    let emailBodyHtml = '';
    
    if (email.body_html) {
        emailBodyHtml = email.body_html;
        // Convert HTML to plain text for text version
        emailBody = email.body_html.replace(/<[^>]*>/g, '')  // Remove HTML tags
            .replace(/&nbsp;/g, ' ')  // Replace &nbsp; with space
            .replace(/\s+/g, ' ')     // Normalize whitespace
            .trim();
    } else {
        // Fallback to text version if HTML is not available
        emailBody = email.body_text || '';
        emailBodyHtml = emailBody;  // Use plain text as HTML if no HTML version exists
    }

    // Get base URL from environment variable
    // Dış erişim için NEXTAUTH_URL kullanılır (attachment linkleri için)
    const baseUrl = process.env.NEXTAUTH_URL;

    // Extract phone number from email body
    const phoneNumberMatch = emailBody.match(/Tel No:([^\n]*)/);
    const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1].trim() : '';
    const phoneNumberUrl = phoneNumber ? `bx://v2/crm.robotpos.com/phone/number/${phoneNumber}` : '';

    // Extract voice recording link from email body
    const voiceRecordingMatch = emailBody.match(/Ses Kaydı:.*\n?\[([^\]]+)\]/s);
    const voiceRecordingLink = voiceRecordingMatch ? voiceRecordingMatch[1].trim() : '';

    // Get attachments for this email
    const attachmentsResult = await client.query(
      'SELECT * FROM attachments WHERE email_id = $1',
      [email.id]
    );

    const hasAttachments = attachmentsResult.rows.length > 0;
    const attachments = attachmentsResult.rows.map(att => ({
      FILE_NAME: att.filename,
      LINK: `${baseUrl}/attachments/${att.storage_path}`
    }));

    // Create email history link and attachments section
    const encodedEmailId = encodeEmailId(email.id);
    const historyUrl = `${baseUrl}/email/${encodedEmailId}`;
    
    // Create attachments section if there are any attachments
    let attachmentsHtml = '';
    if (hasAttachments) {
      attachmentsHtml = `
<div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
  <h3 style="color: #333;">📎 Ekler:</h3>
  <ul style="list-style: none; padding: 0;">
    ${attachments.map(att => `
      <li style="margin: 5px 0;">
        <a href="${att.LINK}" style="color: #0066cc; text-decoration: none;">
          📄 ${att.FILE_NAME}
        </a>
      </li>
    `).join('')}
  </ul>
</div>`;
    }

    // Combine email body HTML with history link and attachments
    const descriptionWithExtras = `${attachmentsHtml}${emailBodyHtml}

<p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
  <a href="${historyUrl}" style="color: #0066cc; text-decoration: none;">📧 Mail Geçmişini Görüntüle</a>
</p>`;

    let flowResult = null;
    
    // Only create new Flow item if no existing Flow ID was found
    if (!flowId) {
        const flowData = {
            entityTypeId: 1036,
            fields: {
                title: `${email.subject} #FlowID=${email.id}#`,
                ufCrm6_1734677556654: emailBody,  // Plain text version for this field
                opened: "N",
                ufCrm6_1735552809: phoneNumber,
                contactId: 2262,
                ...(voiceRecordingLink && { ufCrm6_1736861734: voiceRecordingLink }),
                ...(phoneNumberUrl && { ufCrm6_1739631842: phoneNumberUrl })
            }
        };

        // Acquire semaphore lock
        const release = await semaphore.acquire();

        try {
          // Step 1: Send to Flow
          // Add a delay before making API call to prevent rate limiting
          const apiCallDelay = 3000; // 3 seconds
          console.log(`[FLOW API] Adding ${apiCallDelay}ms delay before making API call for email #${email.id}...`);
          await new Promise(resolve => setTimeout(resolve, apiCallDelay));
          
          const flowResponse = await fetch(FLOW_API_URL, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Cookie': 'qmb=0.'
              },
              body: JSON.stringify(flowData)
          });

          if (!flowResponse.ok) {
              throw new Error(`Flow API error: ${flowResponse.status}`);
          }

          flowResult = await flowResponse.json();
          flowId = flowResult.result.item.id;
        } finally {
          // Release semaphore lock
          release();
        }
    }

    // Step 2: Prepare and send activity data
    const supportEmail = 'destek@robotpos.com'.toLowerCase();
    
    const extractEmail = (formattedEmail: string): string => {
        const match = formattedEmail.match(/<(.+?)>/);
        return match ? match[1] : formattedEmail;
    };

    const isNotSupportEmail = (addr: string) => {
        const email = extractEmail(addr).toLowerCase().trim();
        return email !== supportEmail && email !== '';
    };
    
    // Ensure arrays exist and filter them
    const filteredToAddresses = (email.to_addresses || []).filter(isNotSupportEmail);
    const filteredCcAddresses = (email.cc_addresses || []).filter(isNotSupportEmail);
    const fromAddress = email.from_address ? (isNotSupportEmail(email.from_address) ? email.from_address : '') : '';

    const activityData = {
      fields: {
        OWNER_TYPE_ID: 1036,
        OWNER_ID: flowId,
        TYPE_ID: 4,
        SUBJECT: email.subject, // Orijinal subject'i kullan (varsa FlowID ile birlikte)
        DESCRIPTION: descriptionWithExtras,
        DESCRIPTION_TYPE: 3,
        DIRECTION: 1,
        PROVIDER_ID: "CRM_EMAIL",
        PROVIDER_TYPE_ID: "EMAIL",
        PRIORITY: 2,
        COMMUNICATIONS: [
          ...(fromAddress ? [{
            ID: email.id,
            ENTITY_TYPE: "EMAIL",
            VALUE: fromAddress,
            TYPE: "EMAIL"
          }] : [])
        ],
        SETTINGS: {
          EMAIL_META: {
            __email: fromAddress,
            from: fromAddress,
            replyTo: fromAddress,
            to: filteredToAddresses.join(", "),
            cc: filteredCcAddresses.join(", ")
          }
        },
        FILES: hasAttachments ? attachments : [] // Eklentileri FILES alanına da ekle
      }
    };

    // Acquire semaphore lock
    const release = await semaphore.acquire();

    try {
      // Send activity to Flow
      // Add a delay before making second API call to prevent rate limiting
      const activityApiCallDelay = 2000; // 2 seconds
      console.log(`[FLOW API] Adding ${activityApiCallDelay}ms delay before making activity API call for email #${email.id}...`);
      await new Promise(resolve => setTimeout(resolve, activityApiCallDelay));
      
      const activityResponse = await fetch(FLOW_ACTIVITY_API_URL, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Cookie': 'qmb=0.'
          },
          body: JSON.stringify(activityData)
      });

      if (!activityResponse.ok) {
          throw new Error(`Flow Activity API error: ${activityResponse.status}`);
      }

      const activityResult = await activityResponse.json();
    } finally {
      // Release semaphore lock
      release();
    }

    // Update email subject with Flow ID
    await client.query(
      `UPDATE emails 
       SET subject = $1,
           senttoflow = true
       WHERE id = $2`,
      [
        email.subject?.includes('#FlowID=') ? email.subject : `${email.subject} #FlowID=${flowId}#`,
        email.id
      ]
    );

    return NextResponse.json({ 
        success: true, 
        data: {
            flow: flowResult,
            activity: activityResult,
            flowId: flowId,
            debug: {
              originalAddresses: {
                to: email.to_addresses,
                cc: email.cc_addresses,
                from: email.from_address
              },
              filteredAddresses: {
                to: filteredToAddresses,
                cc: filteredCcAddresses,
                from: fromAddress
              },
              activityData: activityData
            }
        }
    });

  } catch (error) {
    console.error('[FLOW API ERROR]:', error);
    return NextResponse.json(
        { 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to send to Flow with Activity' 
        },
        { status: 500 }
    );
  } finally {
    if (client) {
        client.release();
    }
  }
}