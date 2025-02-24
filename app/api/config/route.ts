import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    workerMode: process.env.WORKER_MODE || '0'
  });
}
