import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import path from 'path';
import fs from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; filename: string } }
) {
  const id = params.id;
  const filename = params.filename;

  if (!pool) {
    return new NextResponse('Database connection not available', { status: 503 });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Get attachment details from database
    const result = await client.query(
      'SELECT storage_path, filename, content_type FROM attachments WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return new NextResponse('Attachment not found', { status: 404 });
    }

    const attachment = result.rows[0];

    // Get the full path to the attachment
    const projectRoot = process.cwd();
    const attachmentsDir = path.join(projectRoot, 'public', 'attachments');
    const fullPath = path.join(attachmentsDir, attachment.storage_path);
    
    console.log(`[ATTACHMENT DEBUG] Trying to access file at: ${fullPath}`);
    
    // Verify file exists and read the file
    let fileBuffer: Buffer;
    if (!fs.existsSync(fullPath)) {
      // Try alternate path for standalone mode
      const standalonePath = path.join(projectRoot, 'standalone', 'public', 'attachments', attachment.storage_path);
      console.log(`[ATTACHMENT DEBUG] File not found, trying standalone path: ${standalonePath}`);
      
      if (!fs.existsSync(standalonePath)) {
        console.error(`[ATTACHMENT ERROR] File not found at either path: ${fullPath} or ${standalonePath}`);
        return new NextResponse('File not found', { status: 404 });
      }
      
      // Use the standalone path
      fileBuffer = fs.readFileSync(standalonePath);
    } else {
      fileBuffer = fs.readFileSync(fullPath);
    }

    // Set response headers
    const headers = new Headers();
    headers.set('Content-Type', attachment.content_type || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${attachment.filename}"`);
    headers.set('Content-Length', fileBuffer.length.toString());

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    console.error('Error serving attachment:', error);
    return new NextResponse('Internal server error', { status: 500 });
  } finally {
    if (client) {
      try {
        await client.release();
      } catch (e: unknown) {
        console.error('Error releasing client:', e);
      }
    }
  }
}
