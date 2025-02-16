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

    // Verify file exists
    if (!fs.existsSync(attachment.storage_path)) {
      return new NextResponse('File not found', { status: 404 });
    }

    // Read file
    const fileBuffer = fs.readFileSync(attachment.storage_path);

    // Set response headers
    const headers = new Headers();
    headers.set('Content-Type', attachment.content_type || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${attachment.filename}"`);
    headers.set('Content-Length', fileBuffer.length.toString());

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving attachment:', error);
    return new NextResponse('Internal server error', { status: 500 });
  } finally {
    if (client) {
      try {
        await client.release();
      } catch (e) {
        console.error('Error releasing client:', e);
      }
    }
  }
}
