-- Create email_flow_locks table
CREATE TABLE IF NOT EXISTS email_flow_locks (
    email_id INTEGER PRIMARY KEY REFERENCES emails(id),
    locked_until TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_email_flow_locks_locked_until ON email_flow_locks(locked_until);
