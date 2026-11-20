-- Aditivo; preservar tokens e licenças existentes.
ALTER TABLE activation_tokens ADD COLUMN welcomed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_activation_tokens_welcome ON activation_tokens(license_id,welcomed_at,expires_at);
