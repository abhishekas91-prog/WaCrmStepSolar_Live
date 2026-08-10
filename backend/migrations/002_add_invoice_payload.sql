-- Add invoice_payload jsonb to invoices table if missing
ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS invoice_payload jsonb;
