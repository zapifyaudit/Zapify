-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet Nonces for Auth
CREATE TABLE IF NOT EXISTS wallet_nonces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scans History Table
CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT,
  address TEXT,
  contract_address TEXT,
  token_name TEXT,
  token_symbol TEXT,
  symbol TEXT,
  score INT,
  risk_score INT,
  verdict TEXT,
  subclass TEXT,
  coverage_ok INT,
  coverage_total INT,
  coverage JSONB,
  raw_modules JSONB,
  raw_report JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if table was created previously
ALTER TABLE scans ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS contract_address TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS token_name TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS token_symbol TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS score INT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS risk_score INT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS subclass TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS coverage_ok INT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS coverage_total INT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS raw_modules JSONB;

-- Findings per Scan Table
CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  weight INT DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and public read policies
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scans' AND policyname = 'Public can view scans'
  ) THEN
    CREATE POLICY "Public can view scans" ON scans FOR SELECT USING (true);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'findings' AND policyname = 'Public can view findings'
  ) THEN
    CREATE POLICY "Public can view findings" ON findings FOR SELECT USING (true);
  END IF;
END $$;