import * as dotenv from 'dotenv';
import { mkdir } from 'fs/promises';
import path from 'path';
import { EmailProcessor } from '@/lib/processors/imap.processor';

// .env dosyasını yükle
dotenv.config();

// Sabitler
const WORKER_INTERVAL = 90000; // 90 saniye
const MAX_PROCESS_TIME = 300000; // 5 dakika

// İşlem kilidi
let isProcessing = false;
let lastProcessTime = Date.now();

interface ProcessResult {
  success: boolean;
  error?: string;
  details?: string;
}

async function worker(): Promise<ProcessResult> {
  // Eğer işlem devam ediyorsa yeni işlem başlatma
  if (isProcessing) {
    // Son işlemden bu yana 5 dakika geçtiyse kilidi kaldır
    if (Date.now() - lastProcessTime > MAX_PROCESS_TIME) {
      console.log('[WORKER] Previous process exceeded timeout, resetting lock...');
      isProcessing = false;
    } else {
      console.log('[WORKER] Another process is still running, skipping this cycle...');
      return {
        success: false,
        error: 'Another process is still running'
      };
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

    if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD || !process.env.IMAP_HOST) {
      throw new Error('Missing required IMAP configuration');
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

    // Email işleme
    console.log('\n[WORKER] Step 1: Processing emails...');
    const processor = new EmailProcessor();
    
    try {
      await processor.processEmails();
      console.log('[WORKER] ✓ Email processing completed successfully');
      return {
        success: true,
        details: 'All emails processed successfully'
      };
    } catch (error) {
      console.error('[WORKER] ✗ Email processing failed:', error);
      throw error;
    }

  } catch (error) {
    console.error('\n[WORKER] ✗ Worker process failed:', error);
    return {
      success: false,
      error: error.message,
      details: error.stack
    };
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
