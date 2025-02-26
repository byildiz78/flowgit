import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { mkdir } from 'fs/promises';
import path from 'path';
import { EmailProcessor } from '@/lib/processors/imap.processor';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Worker token kontrolü
  const headersList = headers();
  const workerToken = headersList.get('x-worker-token');
  const isWorkerRequest = workerToken === process.env.WORKER_API_TOKEN;

  if (!isWorkerRequest) {
    console.log('[EMAIL API] Unauthorized request - missing or invalid worker token');
    return NextResponse.json({ 
      success: false, 
      error: 'Unauthorized - Worker token required'
    }, { status: 401 });
  }

  try {
    // Attachments klasörünü oluştur
    const projectRoot = process.cwd();
    const attachmentsDir = path.join(projectRoot, 'public', 'attachments');
    
    try {
      await mkdir(attachmentsDir, { recursive: true });
      console.log(`[EMAIL API] ✓ Attachments directory ready: ${attachmentsDir}`);
    } catch (error) {
      console.error('[EMAIL API] ✗ Failed to create attachments directory:', error);
      throw error;
    }

    // Email işlemeyi asenkron başlat
    const processor = new EmailProcessor();
    processor.processEmails()
      .then(result => {
        console.log('[EMAIL API] Email processing completed:', result);
      })
      .catch(error => {
        console.error('[EMAIL API] Email processing failed:', error);
      });

    // Hemen başarılı yanıt dön
    return NextResponse.json({
      success: true,
      details: 'Email processing started'
    });

  } catch (error) {
    console.error('[EMAIL API] Failed to start email processing:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}