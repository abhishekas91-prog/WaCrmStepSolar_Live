-- Supabase migration: create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text UNIQUE NOT NULL,
  contact_phone text,
  customer_name text,
  amount numeric,
  status text,
  file_path text,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  meta_message jsonb
);
