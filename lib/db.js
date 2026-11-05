// Postgres access. Production / Vercel: set DATABASE_URL (Neon or Vercel Postgres,
// use the pooled connection string). Local dev and tests with no DATABASE_URL:
// an embedded PGlite database (real Postgres compiled to WASM, a dev dependency),
// stored in ./data/pglite or in memory when PGLITE_DIR=memory.
// All SQL is plain Postgres, so both backends behave the same.
import fs from "node:fs";
import path from "node:path";
import { appDataDir, migrateLegacyData } from "./appdir.js";

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

-- CRM: manual contacts reuse leads, so scanner-only columns become optional and new ones are added.
ALTER TABLE leads ALTER COLUMN place_id DROP NOT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'new';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'kestrel';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_notes TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_bucket_check') THEN
    ALTER TABLE leads DROP CONSTRAINT leads_bucket_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_bucket_ck') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_bucket_ck CHECK (bucket IN ('no_website','has_website','unknown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_stage_ck') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_stage_ck CHECK (stage IN ('new','contacted','replied','meeting_booked','proposal_sent','won','lost','not_interested'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_ck') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_source_ck CHECK (source IN ('kestrel','inbound','referral','manual','seminar'));
  END IF;
END $$;
UPDATE leads SET stage = 'contacted' WHERE status = 'contacted' AND stage = 'new';
UPDATE leads SET stage = 'not_interested' WHERE status = 'do_not_contact' AND stage = 'new';
CREATE INDEX IF NOT EXISTS idx_leads_brand_stage ON leads (brand_id, stage);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note','call','email_in','email_out','meeting','stage_change','payment','system')),
  body TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities (lead_id, id DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  brand_id TEXT NOT NULL,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_on TEXT NOT NULL,
  done_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks (brand_id, due_on) WHERE done_at IS NULL;

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

ALTER TABLE runs ADD COLUMN IF NOT EXISTS total_searches INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS area_scans (
  campaign_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  family TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  results INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, location, family)
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
  const dir = process.env.PGLITE_DIR === "memory" ? undefined : process.env.PGLITE_DIR || path.join(appDataDir(), "pglite");
  if (dir && !process.env.PGLITE_DIR && !process.env.KESTREL_DATA_DIR) migrateLegacyData();
  const db = await openLocal(dir);
  // A freshly started local app cannot have a scan in flight, so any run still marked running
  // was cut off by the last stop. Close it out so the dashboard does not show it forever.
  await db.query("UPDATE runs SET status = 'interrupted', finished_at = $1, error = COALESCE(error, 'The app was stopped while this scan was running.') WHERE status = 'running'", [new Date().toISOString()]);
  return (text, params) => db.query(text, params);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/**
 * The embedded database is single-process. We keep our own lock file (with a real process id)
 * beside the folder, refuse to open it if another live copy of the app holds it, and treat a
 * lock from a dead process as stale. PGlite's own postmaster.pid is left behind by any unclean
 * stop (Ctrl+C, a closed terminal, a crash) and then blocks the next start, so a stale one is
 * removed here instead of treating the database as damaged.
 */
function acquireLock(dir) {
  const lock = dir + ".lock";
  try {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (pid && pid !== process.pid && pidAlive(pid)) {
      throw new Error("Another copy of Kestrel (process " + pid + ") is already using the local database. Stop it first, then start again.");
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.rmSync(path.join(dir, "postmaster.pid"), { force: true });
  fs.writeFileSync(lock, String(process.pid));
  return () => fs.rmSync(lock, { force: true });
}

/** Close the database on a normal exit signal, and always release our lock. */
function closeOnExit(db, release) {
  if (globalThis.__kestrelCloseHooked) return;
  globalThis.__kestrelCloseHooked = true;
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      Promise.resolve(db.close()).catch(() => {}).finally(() => { release(); process.exit(0); });
    });
  }
}

/**
 * Opens the embedded database. A damaged folder is a last resort: it is moved aside, never
 * deleted, and only after the stale lock has been cleared and opening still fails.
 */
export async function openLocal(dir) {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const release = dir ? acquireLock(dir) : () => {};
  let db;
  try {
    db = new PGlite(dir);
    await db.exec(SCHEMA);
    if (dir) closeOnExit(db, release);
    return db;
  } catch (err) {
    if (!dir) throw err;
    try { await db?.close(); } catch { /* already broken */ }
    const aside = dir + ".broken-" + Date.now();
    try {
      fs.renameSync(dir, aside);
    } catch {
      release();
      throw new Error("The local database folder looks damaged (" + err.message + ") and could not be moved aside. Stop every running copy of the app, then rename " + dir + " and start again.");
    }
    console.warn("[kestrel] The local database could not be opened even after clearing its lock. Moved it to " + aside + " and started a fresh one.");
    const fresh = new PGlite(dir);
    await fresh.exec(SCHEMA);
    closeOnExit(fresh, release);
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
