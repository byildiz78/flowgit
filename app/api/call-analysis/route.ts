import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { EmailService } from '@/lib/services/email.service';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!startDate || !endDate) {
    return NextResponse.json(
      { message: 'startDate ve endDate parametreleri gereklidir' },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    // Öncelikle subject içinde telefon numarası olan e-postaları alıyoruz
    const query = `
      SELECT 
        e.id,
        e.subject,
        e.from_address,
        e.received_date
      FROM 
        emails e
      WHERE 
        e.received_date >= $1::date AND e.received_date <= ($2::date + interval '1 day')
      ORDER BY 
        e.received_date DESC
    `;

    const result = await client.query(query, [startDate, endDate]);
    
    // Telefon numaralarını subject'ten çıkarıp gruplayacağız
    const phoneNumberMap = new Map();
    
    for (const email of result.rows) {
      // Make sure subject is not null before trying to extract phone number
      const phoneNumber = email.subject ? EmailService.extractPhoneNumber(email.subject) : null;
      
      if (phoneNumber) {
        if (!phoneNumberMap.has(phoneNumber)) {
          phoneNumberMap.set(phoneNumber, {
            phoneNumber,
            callCount: 1,
            emails: [email]
          });
        } else {
          const entry = phoneNumberMap.get(phoneNumber);
          entry.callCount += 1;
          entry.emails.push(email);
        }
      }
    }
    
    // Birden fazla kez arayan numaraları filtreliyoruz
    const multiCallAnalysis = Array.from(phoneNumberMap.values())
      .filter(entry => entry.callCount > 1)
      .sort((a, b) => b.callCount - a.callCount);

    return NextResponse.json(multiCallAnalysis);
  } catch (error) {
    console.error("Call analysis error:", error);
    console.error("Error details:", error instanceof Error ? error.stack : 'Unknown error');
    return NextResponse.json(
      { message: 'Arama analizi verileri alınırken bir hata oluştu', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
