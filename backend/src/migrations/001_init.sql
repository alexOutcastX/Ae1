-- ProApp initial schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE,
  password_hash   text,
  google_sub      text UNIQUE,
  display_name    text,
  credits         integer NOT NULL DEFAULT 0,
  is_premium      boolean NOT NULL DEFAULT false,
  premium_until   timestamptz,
  fcm_token       text,
  streak_count    integer NOT NULL DEFAULT 0,
  last_checkin    date,
  last_share_reward timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only credit ledger. Cached balance lives on users.credits.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       integer NOT NULL,
  reason      text NOT NULL,
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id);

CREATE TABLE IF NOT EXISTS purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product             text NOT NULL,
  amount_paise        integer NOT NULL,
  razorpay_order_id   text UNIQUE,
  razorpay_payment_id text,
  status              text NOT NULL DEFAULT 'created',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
