-- Initial D1 schema for tasks server

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  approved_by TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_machines_token_hash ON machines (token_hash);

CREATE TABLE IF NOT EXISTS device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  machine_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied | claimed
  approved_by TEXT,
  requester_ip TEXT,
  requester_country TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes (user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires_at ON device_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_device_codes_ip_created ON device_codes (requester_ip, created_at);

-- Lightweight index for the CF-Access-protected human Web UI only.
-- Never exposed on /api/* so rooms stay capability-gated by UID.
CREATE TABLE IF NOT EXISTS rooms_index (
  uid TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_index_updated_at ON rooms_index (updated_at DESC);
