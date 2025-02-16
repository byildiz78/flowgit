import { NextResponse } from 'next/server';
import Imap from 'node-imap';

const imapConfig = {
  user: process.env.EMAIL,
  password: process.env.EMAIL_PASSWORD,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT || '993'),
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  connTimeout: 10000, // Connection timeout in ms
  authTimeout: 5000   // Auth timeout in ms
};

export async function GET() {
  console.log('Testing IMAP connection with config:', {
    ...imapConfig,
    password: '***hidden***'
  });

  return new Promise((resolve) => {
    let connectionTimeout: NodeJS.Timeout;
    let imap: Imap | null = null;

    try {
      // Set a timeout for the entire connection attempt
      connectionTimeout = setTimeout(() => {
        if (imap) {
          imap.destroy();
        }
        resolve(new NextResponse(JSON.stringify({
          success: false,
          message: 'IMAP connection timeout after 15 seconds',
          config: {
            host: imapConfig.host,
            port: imapConfig.port,
            user: imapConfig.user
          }
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }));
      }, 15000);

      imap = new Imap(imapConfig);

      imap.once('ready', () => {
        clearTimeout(connectionTimeout);
        console.log('IMAP connection successful');
        imap?.end();
        resolve(new NextResponse(JSON.stringify({
          success: true,
          message: 'IMAP connection successful',
          config: {
            host: imapConfig.host,
            port: imapConfig.port,
            user: imapConfig.user
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }));
      });

      imap.once('error', (error: Error) => {
        clearTimeout(connectionTimeout);
        console.error('IMAP connection test failed:', error);
        if (imap) {
          imap.destroy();
        }
        resolve(new NextResponse(JSON.stringify({
          success: false,
          message: `IMAP connection failed: ${error.message}`,
          error: error.message,
          config: {
            host: imapConfig.host,
            port: imapConfig.port,
            user: imapConfig.user
          }
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }));
      });

      imap.once('end', () => {
        console.log('IMAP connection ended');
      });

      imap.connect();
    } catch (error) {
      clearTimeout(connectionTimeout);
      console.error('IMAP connection test failed:', error);
      if (imap) {
        imap.destroy();
      }
      resolve(new NextResponse(JSON.stringify({
        success: false,
        message: 'IMAP connection failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        config: {
          host: imapConfig.host,
          port: imapConfig.port,
          user: imapConfig.user
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }));
    }
  });
}
