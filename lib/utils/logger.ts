import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { mkdir } from 'fs/promises';

// Log dosyaları için dizin
const LOG_DIR = path.join(process.cwd(), 'logs');

// Log dizinini oluştur
mkdir(LOG_DIR, { recursive: true }).catch(error => {
  console.error('[LOGGER ERROR] Failed to create log directory:', error);
});

// Log formatı
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
    }`;
  })
);

// Günlük rotasyonlu transport
const dailyRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'worker-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d', // 14 gün sakla
  maxSize: '20m',  // Her dosya max 20MB
  auditFile: path.join(LOG_DIR, 'audit.json')
});

// Logger instance
export const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // Konsola yazdır
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Dosyaya yazdır
    dailyRotateTransport
  ]
});

// Log seviyelerine göre metodlar
export const logWorker = {
  start: (message: string) => logger.info(`[WORKER START] ${message}`),
  success: (message: string) => logger.info(`[WORKER SUCCESS] ${message}`),
  error: (message: string, error?: any) => logger.error(`[WORKER ERROR] ${message}`, { error }),
  warn: (message: string) => logger.warn(`[WORKER WARN] ${message}`),
  api: {
    start: (endpoint: string, data?: any) => logger.info(`[API REQUEST] ${endpoint}`, { data }),
    success: (endpoint: string, response?: any) => logger.info(`[API SUCCESS] ${endpoint}`, { response }),
    error: (endpoint: string, error: any) => logger.error(`[API ERROR] ${endpoint}`, { error })
  },
  email: {
    start: (uid: number) => logger.info(`[EMAIL START] Processing email UID #${uid}`),
    success: (uid: number) => logger.info(`[EMAIL SUCCESS] Processed email UID #${uid}`),
    error: (uid: number, error: any) => logger.error(`[EMAIL ERROR] Failed to process email UID #${uid}`, { error }),
    skip: (uid: number, reason: string) => logger.info(`[EMAIL SKIP] Skipping email UID #${uid}: ${reason}`),
    warn: (uid: number, message: string) => logger.warn(`[EMAIL WARN] Email UID #${uid}: ${message}`)
  }
};
