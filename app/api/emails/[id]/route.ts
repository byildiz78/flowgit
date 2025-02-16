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

    const client = await pool.connect();
    try {
      // Fetch email details
      const emailResult = await client.query(
        `SELECT * FROM emails WHERE id = $1`,
        [id]
      );

      if (emailResult.rows.length === 0) {
        return new NextResponse('Email not found', { status: 404 });
      }

      const email = emailResult.rows[0];

      // Fetch attachments
      const attachmentsResult = await client.query(
        `SELECT * FROM attachments WHERE email_id = $1`,
        [id]
      );
      email.attachments = attachmentsResult.rows;

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
  } catch (error) {
    console.error('Error fetching email:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
