import { NextResponse, Request } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!pool) {
    return new NextResponse(JSON.stringify({ 
      error: 'Database connection not available',
      emails: [],
      stats: null
    }), { 
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '10');
  const sortKey = searchParams.get('sortKey') || 'received_date';
  const sortDir = searchParams.get('sortDir') || 'desc';
  const search = searchParams.get('search') || '';

  const offset = (page - 1) * pageSize;

  let client;
  try {
    client = await pool.connect();
    
    // Build search condition
    const searchCondition = search ? `
      AND (
        LOWER(e.subject) LIKE LOWER($1) OR
        LOWER(e.from_address) LIKE LOWER($1) OR
        LOWER(e.to_addresses::text) LIKE LOWER($1) OR
        LOWER(e.cc_addresses::text) LIKE LOWER($1)
      )
    ` : '';

    const searchValue = search ? `%${search}%` : null;
    
    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM emails e 
      WHERE TRUE ${searchCondition}
    `;
    
    const totalResult = await client.query(
      countQuery,
      searchValue ? [searchValue] : []
    );
    const total = parseInt(totalResult.rows[0].count);

    // Get emails with attachments and history
    const emailsQuery = `
      WITH email_history AS (
        SELECT 
          email_id,
          json_agg(
            json_build_object(
              'id', id,
              'status', status,
              'message', message,
              'created_at', created_at
            ) ORDER BY created_at DESC
          ) as history_entries
        FROM email_history
        GROUP BY email_id
      ),
      email_attachments AS (
        SELECT 
          email_id,
          json_agg(
            json_build_object(
              'id', id,
              'filename', filename,
              'storage_path', storage_path,
              'public_url', CASE 
                WHEN storage_path IS NOT NULL 
                THEN concat('/attachments/', storage_path)
                ELSE NULL 
              END
            )
          ) as attachments
        FROM attachments
        GROUP BY email_id
      )
      SELECT 
        e.id,
        e.subject,
        e.from_address,
        e.to_addresses,
        e.cc_addresses,
        e.received_date,
        e.body_text,
        e.body_html,
        e.senttoflow,
        COALESCE(h.history_entries, '[]'::json) as history,
        COALESCE(a.attachments, '[]'::json) as attachments,
        COALESCE(a.attachments, '[]'::json) as list_attachments
      FROM emails e
      LEFT JOIN email_history h ON e.id = h.email_id
      LEFT JOIN email_attachments a ON e.id = a.email_id
      WHERE TRUE ${searchCondition}
      ORDER BY e.${sortKey} ${sortDir}
      LIMIT $${searchValue ? '2' : '1'} 
      OFFSET $${searchValue ? '3' : '2'}
    `;

    const emailsResult = await client.query(
      emailsQuery,
      searchValue ? [searchValue, pageSize, offset] : [pageSize, offset]
    );

    // Get stats
    const statsResult = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM emails)::text as total_emails,
        (SELECT COUNT(*) FROM attachments)::text as total_attachments,
        (SELECT MAX(received_date)::text FROM emails) as last_processed
    `);

    return new NextResponse(JSON.stringify({
      emails: emailsResult.rows,
      stats: statsResult.rows[0],
      total
    }), { 
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('Database error:', error);
    return new NextResponse(JSON.stringify({ 
      error: 'Failed to fetch emails',
      emails: [],
      stats: null
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}