-- Önce detail kolonunu kaldır (muhtemelen yanlışlıkla eklenmiş)
ALTER TABLE email_history DROP COLUMN IF EXISTS detail;

-- details kolonunu JSONB'ye çevir
ALTER TABLE email_history 
  ALTER COLUMN details TYPE JSONB USING details::jsonb;

-- status için ENUM tipi oluştur
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_status') THEN
    CREATE TYPE email_status AS ENUM ('processing', 'success', 'error');
  END IF;
END$$;

-- status kolonunu ENUM'a çevir
ALTER TABLE email_history 
  ALTER COLUMN status TYPE email_status USING status::email_status;

-- Başarılı gönderimler için UNIQUE constraint ekle
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_success_email 
  ON email_history (email_id) 
  WHERE status = 'success';
