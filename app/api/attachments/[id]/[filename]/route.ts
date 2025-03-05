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
    
    // Try multiple possible locations for the attachment file
    const possiblePaths = [
      // Normal development path
      path.join(projectRoot, 'public', 'attachments', attachment.storage_path),
      // Standalone mode path
      path.join(projectRoot, 'standalone', 'public', 'attachments', attachment.storage_path),
      // Direct path in case it's stored with full path
      attachment.storage_path
    ];
    
    // Debug all paths we're checking
    console.log(`[ATTACHMENT DEBUG] Checking paths for attachment ${id}:`);
    possiblePaths.forEach(p => console.log(`- ${p}`));
    
    // Find the first path that exists
    let filePath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        console.log(`[ATTACHMENT DEBUG] Found file at: ${filePath}`);
        break;
      }
    }
    
    if (!filePath) {
      console.error(`[ATTACHMENT ERROR] File not found at any of the checked paths`);
      return new NextResponse('File not found', { status: 404 });
    }
    
    // Read file
    const fileBuffer = fs.readFileSync(filePath);

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
