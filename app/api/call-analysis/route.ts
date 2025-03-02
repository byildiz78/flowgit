import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { format } from 'date-fns';

export async function GET(req: NextRequest) {
  const client = await pool.connect();
  
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json(
        { error: 'Başlangıç ve bitiş tarihleri gereklidir' },
        { status: 400 }
      );
    }

    // SQL query to find repeating phone numbers in email subjects
    const query = `
      WITH PhoneEmails AS (
        SELECT
          id,
          subject,
          from_address,
          received_date,
          substring(subject from '#\\+9[0-9]{10,12}#') as phone_number
        FROM
          emails
        WHERE
          subject LIKE '%#+9%'
          AND DATE(received_date) BETWEEN $1::date AND $2::date
      ),
      CallCounts AS (
        SELECT
          phone_number,
          COUNT(*) as call_count,
          MAX(received_date) as last_date,
          MIN(received_date) as first_date
        FROM
          PhoneEmails
        WHERE phone_number IS NOT NULL
        GROUP BY
          phone_number
      )
      SELECT
        pe.id,
        pe.subject,
        pe.from_address,
        pe.received_date,
        pe.phone_number,
        cc.call_count,
        cc.last_date,
        cc.first_date
      FROM
        PhoneEmails pe
      JOIN
        CallCounts cc ON pe.phone_number = cc.phone_number
      ORDER BY
        cc.call_count DESC,
        pe.received_date DESC
    `;

    const result = await client.query(query, [from, to]);

    // Group by phone number
    const phoneCallAnalysis = [];
    const phoneGroups = {};

    for (const row of result.rows) {
      const phoneNumber = row.phone_number;
      
      if (!phoneGroups[phoneNumber]) {
        phoneGroups[phoneNumber] = {
          phoneNumber,
          callCount: parseInt(row.call_count || '0'),
          lastDate: row.last_date ? format(new Date(row.last_date), 'dd.MM.yyyy') : '',
          firstDate: row.first_date ? format(new Date(row.first_date), 'dd.MM.yyyy') : '',
          emails: []
        };
        phoneCallAnalysis.push(phoneGroups[phoneNumber]);
      }
      
      phoneGroups[phoneNumber].emails.push({
        id: row.id,
        subject: row.subject || '',
        from_address: row.from_address || '',
        received_date: row.received_date || new Date().toISOString()
      });
    }

    return NextResponse.json({ data: phoneCallAnalysis });
  } catch (error) {
    console.error('Error in call analysis:', error);
    return NextResponse.json(
      { error: 'Arama analizi gerçekleştirilemedi', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
