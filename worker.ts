import * as dotenv from 'dotenv';
import { mkdir } from 'fs/promises';
import { ATTACHMENTS_DIR } from './lib/config/imap.config';
import { fetch } from 'undici';

// .env dosyasını yükle
dotenv.config();

interface ApiResponse {
  success?: boolean;
  error?: string;
  details?: string;
}

async function worker() {
  try {
    console.log('[WORKER] Starting email processing...');
    
    // Environment değişkenlerini kontrol et
    if (!process.env.WORKER_API_TOKEN) {
      throw new Error('WORKER_API_TOKEN is not set in environment');
    }

    // Attachments klasörünü oluştur
    try {
      await mkdir(ATTACHMENTS_DIR, { recursive: true });
      console.log('[WORKER] Attachments directory:', ATTACHMENTS_DIR);
    } catch (error) {
      console.error('[WORKER] Error creating attachments directory:', error);
      throw error;
    }
    
    const baseUrl = process.env.HOST || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/process-emails`, {
      method: 'POST',
      headers: {
        'x-worker-token': process.env.WORKER_API_TOKEN,
      }
    });
    
    const data = await res.json() as ApiResponse;
    
    if (!res.ok) {
      throw new Error(data.details || data.error || 'Failed to process emails');
    }
    
    if (data.success) {
      console.log('[WORKER] Emails processed successfully');
    } else {
      throw new Error(data.details || data.error || 'Failed to process emails');
    }
  } catch (error) {
    console.error('[WORKER] Error processing emails:', error);
  }
}

// İlk çalıştırma
worker();

// Her 90 saniyede bir çalıştır
setInterval(worker, 90000); // 90 saniye = 90000 ms
