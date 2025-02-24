import { Config } from 'node-imap';
import path from 'path';

// IMAP configuration
export const imapConfig: Config = {
  user: process.env.EMAIL,
  password: process.env.EMAIL_PASSWORD,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT || '993'),
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  keepalive: true,
  debug: console.log,
  authTimeout: 3000
};

// Proje kök dizinini bul
const projectRoot = path.resolve(__dirname, '..', '..');

// Attachments configuration
export const ATTACHMENTS_DIR = path.join(projectRoot, 'public', 'attachments');
