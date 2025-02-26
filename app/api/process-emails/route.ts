import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { mkdir } from 'fs/promises';
import path from 'path';
import { EmailProcessor } from '@/lib/processors/imap.processor';
import { getToken } from 'next-auth/jwt';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Global process tracking
let isProcessing = false;
let lastProcessTime = Date.now();
const PROCESS_TIMEOUT = 1 * 60 * 1000; // 1 minute

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

  // Check if another process is running
  if (isProcessing) {
    // Reset flag if process is stuck
    if (Date.now() - lastProcessTime > PROCESS_TIMEOUT) {
      console.log('[EMAIL API] Previous process exceeded timeout, resetting flag...');
      isProcessing = false;
    } else {
      console.log('[EMAIL API] Another process is still running, skipping...');
      return NextResponse.json({
        success: false,
        error: 'Another process is still running'
      });
    }
  }

  const client = await pool.connect();

  try {
    // Set processing flag in database
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM emails 
      WHERE processing = true 
      AND processing_started_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
    `);

    if (result.rows[0].count > 0) {
      console.log('[EMAIL API] Active email processing detected in database, skipping...');
      await client.query('ROLLBACK');
      return NextResponse.json({
        success: false,
        error: 'Active email processing detected'
      });
    }

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

    // Set global processing flag
    isProcessing = true;
    lastProcessTime = Date.now();

    // Email işlemeyi başlat
    const processor = new EmailProcessor();
    processor.processEmails()
      .then(result => {
        console.log('[EMAIL API] Email processing completed:', result);
        isProcessing = false;
        lastProcessTime = Date.now();
      })
      .catch(error => {
        console.error('[EMAIL API] Email processing failed:', error);
        isProcessing = false;
        lastProcessTime = Date.now();
      });

    await client.query('COMMIT');

    // Hemen başarılı yanıt dön
    return NextResponse.json({
      success: true,
      details: 'Email processing started'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[EMAIL API] Failed to start email processing:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  } finally {
    client.release();
  }
}