import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      return new NextResponse('Invalid email ID', { status: 400 });
    }

    if (!pool) {
      return new NextResponse(JSON.stringify({ 
        error: 'Database connection not available'
      }), { 
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const client = await pool.connect();
    try {
      // Fetch email details with HTML content
      const emailResult = await client.query(
        `SELECT 
          e.*
        FROM emails e 
        WHERE e.id = $1`,
        [id]
      );

      if (emailResult.rows.length === 0) {
        return new NextResponse('Email not found', { status: 404 });
      }

      const email = emailResult.rows[0];

      // Fetch attachments
      const attachmentsResult = await client.query(
        `SELECT 
          id,
          filename,
          storage_path
        FROM attachments 
        WHERE email_id = $1`,
        [id]
      );

      // Process attachments
      const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
      const baseUrl = `${protocol}://${request.headers.get('host')}`;
      
      const attachments = attachmentsResult.rows.map(att => ({
        FILE_NAME: att.filename,
        LINK: `${baseUrl}/attachments/${att.storage_path}`
      }));

      // Create attachments section if there are any attachments
      let attachmentsHtml = '';
      if (attachmentsResult.rows.length > 0) {
        attachmentsHtml = `
<div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
  <h3 style="color: #333;">📎 Ekler:</h3>
  <ul style="list-style: none; padding: 0;">
    ${attachments.map(att => `
      <li style="margin: 5px 0;">
        <a href="${att.LINK}" style="color: #0066cc; text-decoration: none;">
          📄 ${att.FILE_NAME}
        </a>
      </li>
    `).join('')}
  </ul>
</div>`;
      }

      // Combine email body HTML with attachments
      email.body_html = `${attachmentsHtml}${email.body_html}`;

      // Add attachments array for frontend
      email.attachments = attachmentsResult.rows.map(att => ({
        ...att,
        public_url: `/attachments/${att.storage_path}`
      }));

      // Fetch history
      const historyResult = await client.query(
        `SELECT * FROM email_history WHERE email_id = $1 ORDER BY created_at DESC`,
        [id]
      );
      email.history = historyResult.rows;

      return NextResponse.json(email);
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    console.error('Error fetching email:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
