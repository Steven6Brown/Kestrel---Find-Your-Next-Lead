// SQLite via Node's built-in node:sqlite (Node 22.5+, no native dependency).
// All access goes through lib/store.js so this can be swapped for Postgres
// (Neon / Vercel Postgres) without touching the rest of the app.
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id TEXT NOT NULL,
  query TEXT NOT NULL,
  results INTEGER NOT NULL DEFAULT 0,
  new_leads INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
`;

export function getDb() {
  if (globalThis.__sitescoutDb) return globalThis.__sitescoutDb;
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const file = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "sitescout.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  globalThis.__sitescoutDb = db;
  return db;
}
