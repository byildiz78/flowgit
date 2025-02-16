import { NextResponse } from 'next/server';
import pool from '@/lib/db';

const FLOW_API_URL = 'https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.add';

export async function POST(request: Request) {
  let client = null;
  let email = null;
  
  try {
    const body = await request.json();
    email = body.email;

    // Extract phone number from email body
    const phoneNumberMatch = email.body_text.match(/Tel No:([^\n]*)/);
    const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1].trim() : '';
    const phoneNumberUrl = phoneNumber ? `bx://v2/crm.robotpos.com/phone/number/${phoneNumber}` : '';

    // Extract voice recording link from email body
    const voiceRecordingMatch = email.body_text.match(/Ses Kaydı:.*\n?\[([^\]]+)\]/s);
    const voiceRecordingLink = voiceRecordingMatch ? voiceRecordingMatch[1].trim() : '';

    const flowData = {
      entityTypeId: 1036,
      fields: {
        title: `${email.subject} #TicketID=${email.id}#`,
        ufCrm6_1734677556654: email.body_text,
        opened: "N",
        ufCrm6_1735552809: phoneNumber,
        contactId: 2262,
        ...(voiceRecordingLink && { ufCrm6_1736861734: voiceRecordingLink }),
        ...(phoneNumberUrl && { ufCrm6_1739631842: phoneNumberUrl })
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

    // Save to history
    client = await pool.connect();
    const historyResult = await client.query(
      `INSERT INTO email_history (email_id, status, message, details, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        email.id,
        'success',
        `Sent to Flow - ID: ${flowResponse.result.item.id}`,
        JSON.stringify({
          flowId: flowResponse.result.item.id,
          response: flowResponse
        })
      ]
    );

    // Update email subject with Flow ID
    await client.query(
      `UPDATE emails 
       SET subject = $1 
       WHERE id = $2`,
      [
        `${email.subject} #FlowID=${flowResponse.result.item.id}#`,
        email.id
      ]
    );

    return NextResponse.json({ 
      success: true, 
      data: flowResponse,
      historyId: historyResult.rows[0].id
    });

  } catch (error) {
    console.error('[FLOW API ERROR]:', error);
    
    // Save error to history if we have client and email
    if (client && email) {
      try {
        await client.query(
          `INSERT INTO email_history (email_id, status, message, details, created_at) 
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [
            email.id,
            'error',
            'Failed to send to Flow',
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })
          ]
        );
      } catch (historyError) {
        console.error('[HISTORY ERROR]:', historyError);
      }
    }

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
