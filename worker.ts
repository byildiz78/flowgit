import * as dotenv from 'dotenv';
import { mkdir } from 'fs/promises';
import { fetch } from 'undici';
import path from 'path';

// .env dosyasını yükle
dotenv.config();

// Sabitler
const REQUEST_TIMEOUT = 60000; // 60 saniye
const WORKER_INTERVAL = 90000; // 90 saniye
const MAX_PROCESS_TIME = 300000; // 5 dakika

// İşlem kilidi
let isProcessing = false;
let lastProcessTime = Date.now();

interface ApiResponse {
  success?: boolean;
  error?: string;
  details?: string;
}

async function worker() {
  // Eğer işlem devam ediyorsa yeni işlem başlatma
  if (isProcessing) {
    // Son işlemden bu yana 5 dakika geçtiyse kilidi kaldır
    if (Date.now() - lastProcessTime > MAX_PROCESS_TIME) {
      console.log('[WORKER] Previous process exceeded timeout, resetting lock...');
      isProcessing = false;
    } else {
      console.log('[WORKER] Another process is still running, skipping this cycle...');
      return;
    }
  }

  isProcessing = true;
  lastProcessTime = Date.now();
  const startTime = Date.now();

  try {
    console.log('\n[WORKER] ====== Starting email processing ======');
    console.log(`[WORKER] Time: ${new Date().toISOString()}`);
    console.log('[WORKER] Mode: Worker Mode (WORKER_MODE=1)');
    
    // Environment değişkenlerini kontrol et
    if (!process.env.WORKER_API_TOKEN) {
      throw new Error('WORKER_API_TOKEN is not set in environment');
    }

    // Attachments klasörünü oluştur
    const projectRoot = process.cwd();
    const attachmentsDir = path.join(projectRoot, 'public', 'attachments');
    
    try {
      await mkdir(attachmentsDir, { recursive: true });
      console.log(`[WORKER] ✓ Attachments directory ready: ${attachmentsDir}`);
    } catch (error) {
      console.error('[WORKER] ✗ Failed to create attachments directory:', error);
      throw error;
    }

    // API'ye istek at
    console.log('\n[WORKER] Step 1: Checking for new emails...');
    const baseUrl = process.env.HOST || 'http://localhost:3000';

    // Request için AbortController oluştur
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      console.error(`[WORKER] Request timeout after ${REQUEST_TIMEOUT}ms`);
    }, REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${baseUrl}/api/process-emails`, {
        method: 'POST',
        headers: {
          'x-worker-token': process.env.WORKER_API_TOKEN,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as ApiResponse;
      
      if (result.success) {
        console.log('[WORKER] ✓ Email processing completed successfully');
        console.log(`[WORKER] Response status code: ${response.status}`);
        console.log(`[WORKER] Response headers: ${JSON.stringify(response.headers)}`);
        if (result.details) {
          console.log(`[WORKER] Details: ${result.details}`);
        }
      } else {
        console.error('[WORKER] ✗ Email processing failed:', result.error);
        console.error(`[WORKER] Response status code: ${response.status}`);
        console.error(`[WORKER] Response headers: ${JSON.stringify(response.headers)}`);
        if (result.details) {
          console.error(`[WORKER] Error details: ${result.details}`);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

  } catch (error) {
    console.error('\n[WORKER] ✗ Worker process failed:', error);
  } finally {
    const duration = Date.now() - startTime;
    console.log(`\n[WORKER] Process duration: ${duration}ms`);
    console.log('[WORKER] ====== Email processing cycle completed ======\n');
    isProcessing = false;
    lastProcessTime = Date.now();
  }
}

// İlk çalıştırma
worker();

// Her 90 saniyede bir çalıştır
async function scheduleNextRun() {
  const now = Date.now();
  const timeSinceLastRun = now - lastProcessTime;
  
  // Eğer son çalışmadan bu yana 90 saniyeden az geçmişse, kalan süre kadar bekle
  const waitTime = Math.max(0, WORKER_INTERVAL - timeSinceLastRun);
  
  setTimeout(async () => {
    await worker();
    scheduleNextRun();
  }, waitTime);
}

// İlk planlamayı başlat
setTimeout(scheduleNextRun, WORKER_INTERVAL);

// Process sonlandırma sinyallerini yakala
process.on('SIGTERM', () => {
  console.log('\n[WORKER] Received SIGTERM signal');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n[WORKER] Received SIGINT signal');
  process.exit(0);
});
