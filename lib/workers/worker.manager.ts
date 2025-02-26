import { Worker } from 'worker_threads';
import path from 'path';

class WorkerManager {
  private static instance: WorkerManager;
  private worker: Worker | null = null;
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private processingTimeout: NodeJS.Timeout | null = null;
  private readonly PROCESSING_TIMEOUT = 120000; // 2 dakika timeout

  private constructor() {
    this.initializeWorker();
  }

  public static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  private initializeWorker() {
    if (this.worker) {
      return;
    }

    // Worker'ı başlatmadan önce flag'i sıfırla
    this.isProcessing = false;
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }

    this.worker = new Worker(path.join(process.cwd(), 'lib', 'workers', 'email.worker.js'));
    
    this.worker.on('message', (message) => {
      if (typeof message === 'object' && message !== null) {
        console.log('[WORKER MANAGER] Received message from worker:', message);
        this.clearProcessingState();
      } else if (message === 'done') {
        this.clearProcessingState();
      }
    });

    this.worker.on('error', (error) => {
      console.error('[WORKER MANAGER] Worker error:', error);
      this.clearProcessingState();
      this.restartWorker();
    });

    this.worker.on('exit', (code) => {
      console.log(`[WORKER MANAGER] Worker exited with code ${code}`);
      this.clearProcessingState();
      if (code !== 0) {
        console.error(`[WORKER MANAGER] Worker stopped with exit code ${code}`);
        this.restartWorker();
      }
    });
  }

  private clearProcessingState() {
    this.isProcessing = false;
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
  }

  private restartWorker() {
    console.log('[WORKER MANAGER] Restarting worker...');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // Kısa bir gecikme ile yeniden başlat
    setTimeout(() => {
      this.initializeWorker();
    }, 1000);
  }

  public startPeriodicProcessing(intervalMs: number = 90000) {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // İlk çalıştırma
    this.processEmails();

    // Periyodik çalıştırma
    this.processingInterval = setInterval(() => {
      this.processEmails();
    }, intervalMs);
  }

  public stopPeriodicProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  public async processEmails(): Promise<void> {
    // Eğer worker yoksa veya işlem devam ediyorsa
    if (!this.worker || this.isProcessing) {
      console.log('[WORKER MANAGER] Cannot process emails:', 
        !this.worker ? 'Worker not initialized' : 'Another process is still running');
      return;
    }

    // Timeout kontrolü ekle
    this.isProcessing = true;
    this.processingTimeout = setTimeout(() => {
      console.error('[WORKER MANAGER] Processing timeout reached, restarting worker...');
      this.clearProcessingState();
      this.restartWorker();
    }, this.PROCESSING_TIMEOUT);

    try {
      this.worker.postMessage('start');
    } catch (error) {
      console.error('[WORKER MANAGER] Error posting message to worker:', error);
      this.clearProcessingState();
      this.restartWorker();
    }
  }

  public cleanup() {
    this.stopPeriodicProcessing();
    this.clearProcessingState();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export default WorkerManager;
