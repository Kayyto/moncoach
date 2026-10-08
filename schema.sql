-- Mon Coach -- schema D1 (migration depuis Firebase Auth + Firestore)

CREATE TABLE IF NOT EXISTS members (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  account_id TEXT -- compte central (compte.kayto.org), unique
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_account_id ON members(account_id) WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS private_data (
  uid TEXT PRIMARY KEY REFERENCES members(uid) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS streaks (
  uid TEXT PRIMARY KEY REFERENCES members(uid) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_by TEXT REFERENCES members(uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS recipe_overrides (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES members(uid) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
