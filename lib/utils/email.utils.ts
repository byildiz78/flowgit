import { createHash } from 'crypto';
import { ParsedMail } from 'mailparser';

export function isRobotPOSEmail(fromText: string | undefined): boolean {
  if (!fromText) return false;
  
  const normalizedFrom = fromText.toLowerCase().trim();
  console.log(`[FLOW] Checking if email is from RobotPOS. From address: "${fromText}"`);
  
  // Sadece otomatik RobotPOS maillerini kontrol et
  return normalizedFrom.includes('robotpos.noreply@robotpos.com');
}

export function generateDeterministicMessageId(parsed: ParsedMail): string {
  const contentToHash = [
    parsed.subject,
    parsed.text,
    parsed.from?.text,
    parsed.date?.toISOString()
  ].join('|');

  const hash = createHash('sha256')
    .update(contentToHash)
    .digest('hex')
    .substring(0, 32);

  const phoneMatch = parsed.subject?.match(/#\+?(\d+)#/);
  const phone = phoneMatch ? phoneMatch[1] : 'unknown';
  const timestamp = parsed.date?.getTime() || Date.now();

  return `<robotpos-${phone}-${timestamp}-${hash}@local>`;
}
