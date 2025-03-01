import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { mkdir } from 'fs/promises';
import dotenv from 'dotenv';

// .env dosyasını yükle - eğer daha önce yüklenmediyse
if (!process.env.DOTENV_LOADED) {
  dotenv.config();
  process.env.DOTENV_LOADED = 'true';
}

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

// Detaylı API log transportu - sadece detaillog=1 aktifken kullanılır
const detailedApiTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'api-details-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d', // 14 gün sakla
  maxSize: '20m',  // Her dosya max 20MB
  auditFile: path.join(LOG_DIR, 'api-audit.json'),
  level: 'debug' // debug level kullanarak standart loglardan ayırıyoruz
});

// detaillog ayarını kontrol et
const isDetailedLoggingEnabled = process.env.detaillog === '1';

// Eğer detaillog=1 ise API transportunu transports dizisine ekle
const transports = [
  // Konsola yazdır
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
  // Dosyaya yazdır
  dailyRotateTransport
];

// Eğer detaillog=1 ise detaylı API log transportunu ekle
if (isDetailedLoggingEnabled) {
  transports.push(detailedApiTransport);
}

// Logger instance
export const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: transports
});

// Özel API logger instance - detayları kaydetmek için
export const apiDetailLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [detailedApiTransport]
});

// Log seviyelerine göre metodlar
export const logWorker = {
  start: (message: string) => logger.info(`[WORKER START] ${message}`),
  success: (message: string) => logger.info(`[WORKER SUCCESS] ${message}`),
  error: (message: string, error?: any) => logger.error(`[WORKER ERROR] ${message}`, { error }),
  warn: (message: string) => logger.warn(`[WORKER WARN] ${message}`),
  api: {
    start: (endpoint: string, data?: any) => {
      logger.info(`[API REQUEST] ${endpoint}`, { data });
      // Detaylı API log
      if (isDetailedLoggingEnabled) {
        apiDetailLogger.debug(`REQUEST: ${endpoint}`, {
          type: 'request',
          endpoint,
          timestamp: new Date().toISOString(),
          payload: data
        });
      }
    },
    success: (endpoint: string, response?: any) => {
      logger.info(`[API SUCCESS] ${endpoint}`, { response });
      // Detaylı API log
      if (isDetailedLoggingEnabled) {
        apiDetailLogger.debug(`RESPONSE: ${endpoint}`, {
          type: 'response',
          endpoint,
          timestamp: new Date().toISOString(),
          status: 'success',
          data: response
        });
      }
    },
    error: (endpoint: string, error: any) => {
      logger.error(`[API ERROR] ${endpoint}`, { error });
      // Detaylı API log
      if (isDetailedLoggingEnabled) {
        apiDetailLogger.debug(`ERROR: ${endpoint}`, {
          type: 'response',
          endpoint,
          timestamp: new Date().toISOString(),
          status: 'error',
          error: typeof error === 'object' ? 
            { message: error.message, stack: error.stack, ...error } : 
            error
        });
      }
    }
  },
  email: {
    start: (uid: number) => logger.info(`[EMAIL START] Processing email UID #${uid}`),
    success: (uid: number) => logger.info(`[EMAIL SUCCESS] Processed email UID #${uid}`),
    error: (uid: number, error: any) => logger.error(`[EMAIL ERROR] Failed to process email UID #${uid}`, { error }),
    skip: (uid: number, reason: string) => logger.info(`[EMAIL SKIP] Skipping email UID #${uid}: ${reason}`)
  }
};
