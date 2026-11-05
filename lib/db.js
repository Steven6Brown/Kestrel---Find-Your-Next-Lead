// Postgres access. Production / Vercel: set DATABASE_URL (Neon or Vercel Postgres,
// use the pooled connection string). Local dev and tests with no DATABASE_URL:
// an embedded PGlite database (real Postgres compiled to WASM, a dev dependency),
// stored in ./data/pglite or in memory when PGLITE_DIR=memory.
// All SQL is plain Postgres, so both backends behave the same.
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  category_label TEXT,
  address TEXT,
  city TEXT,
  region TEXT,
  phone TEXT,
  website TEXT,
  website_kind TEXT NOT NULL DEFAULT 'none',
  maps_url TEXT,
  bucket TEXT NOT NULL CHECK (bucket IN ('no_website','has_website')),
  mockup_token TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','skipped','do_not_contact')),
  search_label TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (brand_id, place_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_brand_bucket ON leads (brand_id, bucket);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS site_check TEXT NOT NULL DEFAULT 'unchecked';

CREATE TABLE IF NOT EXISTS drafts (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','sent')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  sent_to TEXT,
  resend_id TEXT,
  send_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_brand_status ON drafts (brand_id, status);

CREATE TABLE IF NOT EXISTS suppressions (
  brand_id TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (brand_id, email)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  email_verified_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret TEXT,
  mfa_pending_secret TEXT,
  mfa_last_step BIGINT NOT NULL DEFAULT -1,
  recovery_codes TEXT NOT NULL DEFAULT '[]',
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (brand_id, email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_passed BOOLEAN NOT NULL DEFAULT FALSE,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reset','invite')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  user_id INTEGER,
  event TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_brand ON audit_log (brand_id, id DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  name TEXT NOT NULL,
  categories TEXT NOT NULL,
  locations TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'manual',
  run_time TEXT NOT NULL DEFAULT '06:00',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  last_run_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  campaign_id INTEGER,
  campaign_name TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  searches INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  no_website INTEGER NOT NULL DEFAULT 0,
  has_website INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS searches (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  query TEXT NOT NULL,
  results INTEGER NOT NULL DEFAULT 0,
  new_leads INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
`;

async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(SCHEMA);
    return (text, params) => pool.query(text, params);
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Vercel needs a Postgres connection string (the embedded database cannot persist there).");
  }
  const dir = process.env.PGLITE_DIR === "memory" ? undefined : process.env.PGLITE_DIR || path.join(process.cwd(), "data", "pglite");
  const db = await openLocal(dir);
  return (text, params) => db.query(text, params);
}

/**
 * Opens the embedded database. If the folder is damaged (for example a half-deleted copy),
 * it is moved aside, never deleted, and a fresh database is created. If the folder is in use
 * by another process the move fails and a clear message is shown instead.
 */
export async function openLocal(dir) {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  let db;
  try {
    db = new PGlite(dir);
    await db.exec(SCHEMA);
    return db;
  } catch (err) {
    if (!dir) throw err;
    try { await db?.close(); } catch { /* already broken */ }
    const aside = `${dir}.broken-${Date.now()}`;
    try {
      fs.renameSync(dir, aside);
    } catch {
      throw new Error(`The local database folder looks damaged (${err.message}) and could not be moved aside. Stop every running copy of the app, then rename "${dir}" and start again.`);
    }
    console.warn(`[kestrel] The local database could not be opened. Moved it to ${aside} and started a fresh one.`);
    const fresh = new PGlite(dir);
    await fresh.exec(SCHEMA);
    return fresh;
  }
}

function runner() {
  globalThis.__kestrelDb ??= connect().catch((err) => {
    globalThis.__kestrelDb = undefined; // allow a retry after a failed connect
    throw err;
  });
  return globalThis.__kestrelDb;
}

/** Run SQL written with ? placeholders. Returns an array of plain row objects. */
export async function query(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  const run = await runner();
  const res = await run(text, params);
  return res.rows.map((r) => ({ ...r }));
}
