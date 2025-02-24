import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { headers } from 'next/headers';

const FLOW_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.add';

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

    // Get base URL from request headers
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const baseUrl = `${protocol}://${request.headers.get('host')}`;

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

    // Extract phone number from email body
    const phoneNumberMatch = email.body_text?.match(/Tel No:([^\n]*)/);
    const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1].trim() : '';
    const phoneNumberUrl = phoneNumber ? `bx://v2/crm.robotpos.com/phone/number/${phoneNumber}` : '';

    // Extract voice recording link from email body
    const voiceRecordingMatch = email.body_text?.match(/Ses Kaydı:.*\n?\[([^\]]+)\]/s);
    const voiceRecordingLink = voiceRecordingMatch ? voiceRecordingMatch[1].trim() : '';

    const flowData = {
      entityTypeId: 1036,
      fields: {
        title: `${email.subject} #FlowID=${email.id}#`, 
        ufCrm6_1734677556654: email.body_text || '',
        opened: "N",
        ufCrm6_1735552809: phoneNumber,
        contactId: 2262,
        ...(voiceRecordingLink && { ufCrm6_1736861734: voiceRecordingLink }),
        ...(phoneNumberUrl && { ufCrm6_1739631842: phoneNumberUrl })
      },
      SETTINGS: {
        EMAIL_META: {
          __email: email.from_address,
          from: email.from_address,
          replyTo: email.from_address,
          to: "",
          cc: "",
          bcc: "",
          "BODY": email.body_text
        },
        ...(hasAttachments && {
          HAS_EXTERNAL_ATTACHMENTS: "Y",
          EXTERNAL_ATTACHMENTS: attachments
        })
      }
    };

    const response = await fetch(FLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'qmb=0.'
      },
      body: JSON.stringify(flowData)
    });

    const flowResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Flow API error: ${response.status}`);
    }

    // Update email subject with Flow ID
    client = await pool.connect();
    await client.query(
      `UPDATE emails 
       SET subject = $1,
           senttoflow = true
       WHERE id = $2`,
      [
        email.subject?.includes('#FlowID=') ? email.subject : `${email.subject} #FlowID=${flowResponse.result.item.id}#`,
        email.id
      ]
    );

    return NextResponse.json({ 
      success: true, 
      data: {
        result: flowResponse.result 
      }
    });

  } catch (error) {
    console.error('[FLOW API ERROR]:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to send to Flow' 
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}