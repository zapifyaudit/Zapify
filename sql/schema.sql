-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet Nonces for Auth
CREATE TABLE wallet_nonces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scans History
CREATE TABLE scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT,
  contract_address TEXT NOT NULL,
  token_name TEXT,
  symbol TEXT,
  risk_score INT,
  verdict TEXT,
  subclass TEXT,
  coverage JSONB,
  raw_report JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Findings per Scan
CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  weight INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies (Example for users - adjust based on exact auth flow)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');