import { Worker } from 'worker_threads';
import path from 'path';

class WorkerManager {
  private static instance: WorkerManager;
  private worker: Worker | null = null;
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

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

    this.worker = new Worker(path.join(process.cwd(), 'lib', 'workers', 'email.worker.js'));
    
    this.worker.on('message', (message) => {
      if (message === 'done') {
        this.isProcessing = false;
      }
    });

    this.worker.on('error', (error) => {
      console.error('[WORKER MANAGER] Worker error:', error);
      this.isProcessing = false;
      this.restartWorker();
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[WORKER MANAGER] Worker stopped with exit code ${code}`);
        this.restartWorker();
      }
    });
  }

  private restartWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initializeWorker();
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
    if (this.isProcessing || !this.worker) {
      return;
    }

    this.isProcessing = true;
    this.worker.postMessage('start');
  }

  public cleanup() {
    this.stopPeriodicProcessing();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export default WorkerManager;
