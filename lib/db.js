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
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Production requires a Postgres connection string.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR === "memory" ? undefined : process.env.PGLITE_DIR || path.join(process.cwd(), "data", "pglite");
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = new PGlite(dir);
  await db.exec(SCHEMA);
  return (text, params) => db.query(text, params);
}

function runner() {
  globalThis.__sitescoutDb ??= connect().catch((err) => {
    globalThis.__sitescoutDb = undefined; // allow a retry after a failed connect
    throw err;
  });
  return globalThis.__sitescoutDb;
}

/** Run SQL written with ? placeholders. Returns an array of plain row objects. */
export async function query(sql, params = []) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  const run = await runner();
  const res = await run(text, params);
  return res.rows.map((r) => ({ ...r }));
}
