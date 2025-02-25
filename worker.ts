import * as dotenv from 'dotenv';
import { mkdir } from 'fs/promises';
import { fetch } from 'undici';
import path from 'path';

// .env dosyasını yükle
dotenv.config();

// İşlem kilidi
let isProcessing = false;

interface ApiResponse {
  success?: boolean;
  error?: string;
  details?: string;
}

async function worker() {
  // Eğer işlem devam ediyorsa yeni işlem başlatma
  if (isProcessing) {
    console.log('[WORKER] Another process is still running, skipping this cycle...');
    return;
  }

  isProcessing = true;
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
    const response = await fetch(`${baseUrl}/api/process-emails`, {
      method: 'POST',
      headers: {
        'x-worker-token': process.env.WORKER_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as ApiResponse;
    
    if (result.success) {
      console.log('[WORKER] ✓ Email processing completed successfully');
      if (result.details) {
        console.log(`[WORKER] Details: ${result.details}`);
      }
    } else {
      console.error('[WORKER] ✗ Email processing failed:', result.error);
      if (result.details) {
        console.error(`[WORKER] Error details: ${result.details}`);
      }
    }

  } catch (error) {
    console.error('\n[WORKER] ✗ Worker process failed:', error);
  } finally {
    const duration = Date.now() - startTime;
    console.log(`\n[WORKER] Process duration: ${duration}ms`);
    console.log('[WORKER] ====== Email processing cycle completed ======\n');
    isProcessing = false;
  }
}

// İlk çalıştırma
worker();

// Her 90 saniyede bir çalıştır
const INTERVAL = 90000; // 90 saniye
let lastRunTime = Date.now();

async function scheduleNextRun() {
  const now = Date.now();
  const timeSinceLastRun = now - lastRunTime;
  
  // Eğer son çalışmadan bu yana 90 saniyeden az geçmişse, kalan süre kadar bekle
  if (timeSinceLastRun < INTERVAL) {
    const waitTime = INTERVAL - timeSinceLastRun;
    console.log(`[WORKER] Waiting ${Math.round(waitTime/1000)}s for next cycle...`);
    setTimeout(scheduleNextRun, waitTime);
    return;
  }

  lastRunTime = now;
  try {
    await worker();
  } catch (error) {
    console.error('[WORKER] ✗ Scheduled worker execution failed:', error);
  }
  
  // Sonraki çalıştırmayı planla
  setTimeout(scheduleNextRun, INTERVAL);
}

// İlk planlamayı başlat
setTimeout(scheduleNextRun, INTERVAL);

// Process sonlandırma sinyallerini yakala
process.on('SIGTERM', () => {
  console.log('\n[WORKER] Received SIGTERM signal');
  console.log('[WORKER] Gracefully shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n[WORKER] Received SIGINT signal');
  console.log('[WORKER] Gracefully shutting down...');
  process.exit(0);
});
