import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { encodeEmailId } from '@/lib/emailIdEncoder';

const FLOW_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.add';
const FLOW_ACTIVITY_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.activity.add';

export async function POST(request: Request) {
  let client = null;
  let email = null;
  
  try {
    const body = await request.json();
    email = body.email;

    // Check if Flow ID already exists in the subject
    const flowIdMatch = email.subject.match(/#FlowID=(\d+)#/);
    let flowId = flowIdMatch ? flowIdMatch[1] : null;

    // Get base URL from request headers
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const baseUrl = `${protocol}://${request.headers.get('host')}`;

    // Try to get email body from different sources
    let emailBody = '';
    if (email.body_text) {
        emailBody = email.body_text;
    } else {
        // Try to extract from X-Ham-Report if body is empty
        const hamReport = email.headers?.['x-ham-report'] || '';
        const contentPreviewMatch = hamReport.match(/Content preview:(.*?)Content analysis/s);
        if (contentPreviewMatch && contentPreviewMatch[1]) {
            emailBody = contentPreviewMatch[1].trim()
                .replace(/\[\.\.\.\]/g, '') // Remove [...]
                .replace(/\s+/g, ' '); // Normalize whitespace
        }
    }

    // Extract phone number from email body
    const phoneNumberMatch = emailBody.match(/Tel No:([^\n]*)/);
    const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1].trim() : '';
    const phoneNumberUrl = phoneNumber ? `bx://v2/crm.robotpos.com/phone/number/${phoneNumber}` : '';

    // Extract voice recording link from email body
    const voiceRecordingMatch = emailBody.match(/Ses Kaydı:.*\n?\[([^\]]+)\]/s);
    const voiceRecordingLink = voiceRecordingMatch ? voiceRecordingMatch[1].trim() : '';

    // Prepare text body with attachments
    let formattedBody = '';
    
    // Add email history link
    formattedBody += '\n--Mail Geçmişi--\n';
    const encodedEmailId = encodeEmailId(email.id);
    const historyUrl = `${baseUrl}/email/${encodedEmailId}`;
    formattedBody += `<a href="${historyUrl}">Mail Geçmişini Görüntüle</a>\n`;

    let flowResult = null;
    
    // Only create new Flow item if no existing Flow ID was found
    if (!flowId) {
        const flowData = {
            entityTypeId: 1036,
            fields: {
                title: `${email.subject} #FlowID=${email.id}#`,
                ufCrm6_1734677556654: formattedBody,
                opened: "N",
                ufCrm6_1735552809: phoneNumber,
                contactId: 2262,
                ...(voiceRecordingLink && { ufCrm6_1736861734: voiceRecordingLink }),
                ...(phoneNumberUrl && { ufCrm6_1739631842: phoneNumberUrl })
            }
        };

        // Step 1: Send to Flow
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
        SUBJECT: `${email.subject} #FlowID=${flowId}#`,
        DESCRIPTION: formattedBody,
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
            cc: filteredCcAddresses.join(", "),
            bcc: "",
            "BODY": formattedBody
          },
          ORIGINAL_RECIPIENTS: {
            FROM: fromAddress ? [fromAddress] : [],
            TO: filteredToAddresses,
            CC: filteredCcAddresses,
            BCC: [],
            REPLY_TO: fromAddress,
            CC_LIST: filteredCcAddresses,
            ORIGINAL_CC: filteredCcAddresses,
            MAIL_MESSAGE_HEADERS: {
              "Message-ID": `<${flowId}@robotpos.com>`,
              "References": `<${flowId}@robotpos.com>`,
              "In-Reply-To": `<${flowId}@robotpos.com>`
            }
          }
        }
      }
    };

    // Send activity to Flow
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

    // Update email subject with Flow ID
    client = await pool.connect();
    await client.query(
      `UPDATE emails 
       SET subject = $1 
       WHERE id = $2`,
      [
        email.subject.includes('#FlowID=') ? email.subject : `${email.subject} #FlowID=${flowId}#`,
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