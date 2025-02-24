import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

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

// Her 90 saniyede bir çalıştır (ana sayfayla aynı süre)
setInterval(worker, 90000);
