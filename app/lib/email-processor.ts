import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function processEmails() {
  // 1. İşlenmemiş emailleri al
  const unprocessedEmails = await prisma.email.findMany({
    where: {
      status: 'PENDING'
    },
    include: {
      attachments: true
    }
  });

  for (const email of unprocessedEmails) {
    try {
      // 2. Flow'a gönder
      const response = await fetch(process.env.FLOW_API_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FLOW_API_KEY}`
        },
        body: JSON.stringify({
          emailId: email.id,
          subject: email.subject,
          from: email.from_address,
          to: email.to_addresses,
          cc: email.cc_addresses,
          receivedDate: email.received_date,
          attachments: email.attachments
        })
      });

      if (!response.ok) {
        throw new Error(`Flow API error: ${response.statusText}`);
      }

      // 3. Başarılı işaretle
      await prisma.email.update({
        where: { id: email.id },
        data: { 
          status: 'PROCESSED',
          processed_at: new Date()
        }
      });

      console.log(`[EMAIL-PROCESSOR] Successfully processed email ${email.id}`);
    } catch (error) {
      console.error(`[EMAIL-PROCESSOR] Error processing email ${email.id}:`, error);
      
      // Hata durumunda güncelle
      await prisma.email.update({
        where: { id: email.id },
        data: { 
          status: 'ERROR',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
}
