-- Drop existing index if exists
DROP INDEX IF EXISTS idx_unique_success_email;

-- Create unique index for successful email history records
CREATE UNIQUE INDEX idx_unique_success_email 
ON public.email_history (email_id) 
WHERE status = 'success';
