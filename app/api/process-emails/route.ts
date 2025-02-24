import { NextResponse } from 'next/server';
import EmailProcessor from '@/lib/processors/imap.processor';
import { mkdir } from 'fs/promises';
import path from 'path';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const headersList = headers();
    const isWorker = headersList.get('x-worker-token') === process.env.WORKER_API_TOKEN;
    
    // Worker mode kontrolü
    if (process.env.WORKER_MODE === '1' && !isWorker) {
      return NextResponse.json({ 
        error: 'Email processing is handled by worker',
        success: false
      }, { status: 403 });
    }

    // Ensure attachments directory exists
    const attachmentsDir = path.join(process.cwd(), 'attachments');
    await mkdir(attachmentsDir, { recursive: true });

    const processor = new EmailProcessor();
    
    try {
      await processor.processEmails();
      return NextResponse.json({ 
        success: true,
        message: 'Emails processed successfully'
      });
    } catch (error) {
      console.error('[API ERROR] Error processing emails:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return NextResponse.json({ 
        error: 'Failed to process emails',
        details: errorMessage,
        success: false
      }, { 
        status: error instanceof Error && error.message.includes('Database connection') ? 503 : 500 
      });
    }
  } catch (error) {
    console.error('[API ERROR] Error in email processing route:', error);
    return NextResponse.json({ 
      error: 'Failed to process emails',
      details: error instanceof Error ? error.message : 'Unknown error',
      success: false
    }, { 
      status: 500 
    });
  }
}