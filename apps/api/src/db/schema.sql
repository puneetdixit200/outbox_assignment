CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), google_subject text UNIQUE, email text NOT NULL UNIQUE,
  name text NOT NULL, avatar_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sender_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL, from_email text NOT NULL, smtp_host text, smtp_port integer, smtp_user text, smtp_password text,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_account_id uuid NOT NULL REFERENCES sender_accounts(id), subject text NOT NULL, body text NOT NULL,
  requested_start_at timestamptz NOT NULL, delay_between_emails_ms integer NOT NULL,
  hourly_limit integer NOT NULL, recipient_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN CREATE TYPE scheduled_email_status AS ENUM ('SCHEDULED','ENQUEUE_PENDING','QUEUED','PROCESSING','DEFERRED_RATE_LIMIT','SENT','FAILED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sender_account_id uuid NOT NULL REFERENCES sender_accounts(id), recipient_email text NOT NULL, sequence integer NOT NULL,
  scheduled_at timestamptz NOT NULL, status scheduled_email_status NOT NULL DEFAULT 'ENQUEUE_PENDING', bull_job_id text UNIQUE,
  idempotency_key text NOT NULL UNIQUE, attempt_count integer NOT NULL DEFAULT 0, last_error text, sent_at timestamptz,
  failed_at timestamptz, message_id text, preview_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_emails_campaign_idx ON scheduled_emails(campaign_id, sequence);
CREATE INDEX IF NOT EXISTS scheduled_emails_status_idx ON scheduled_emails(status, scheduled_at);
CREATE INDEX IF NOT EXISTS scheduled_emails_sender_idx ON scheduled_emails(sender_account_id, status, scheduled_at);
