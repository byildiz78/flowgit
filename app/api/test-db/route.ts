import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  let client;
  try {
    console.log('Testing database connection...');
    if (!pool) {
      console.error('Pool is null - Database connection not initialized');
      return new NextResponse(JSON.stringify({
        success: false,
        message: 'Database connection not initialized'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
    
    client = await pool.connect();
    console.log('Successfully connected to database');
    
    // Test query
    const result = await client.query('SELECT NOW()');
    console.log('Query successful:', result.rows[0]);
    
    return new NextResponse(JSON.stringify({
      success: true,
      message: 'Database connection successful',
      timestamp: result.rows[0]
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    console.error('Database connection test failed:', error);
    return new NextResponse(JSON.stringify({
      success: false,
      message: error instanceof Error ? error.message : 'Database connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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
