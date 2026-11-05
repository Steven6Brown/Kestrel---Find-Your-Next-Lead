// Backups: a full copy of the database as one file, that can be checked and restored.
//
// What is saved: every table except short lived sign in data (sessions and one time links), found by asking the
// database, so a table added later is included automatically. The app secret is saved too when it lives in the data
// folder, because two factor secrets cannot be decrypted without it. That makes a backup sensitive, so set
// BACKUP_PASSPHRASE and the file is encrypted (AES 256 GCM; the key comes from the passphrase with scrypt).
//
// Restoring never touches a database that has data: it fills a brand new, empty one (scripts/restore-backup.mjs).
// All SQL here is plain Postgres, so it works for the local database and for a hosted one.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { appDataDir } from "./appdir.js";

export const BACKUP_FORMAT = 1;
export const EXCLUDED_TABLES = ["sessions", "auth_tokens"];
export const BACKUP_NAME = /^kestrel-backup-\d{8}-\d{6}\.kbk\.(gz|enc)$/;
export const DEFAULT_KEEP = 30;
export const STALE_DAYS = 7;
const MAX_BYTES = 500 * 1024 * 1024;
const MAGIC = Buffer.from("KBKE1");
const IDENT = /^[a-z_][a-z0-9_]*$/;

/** An error whose message is safe and useful to show a person. */
export class BackupError extends Error {}

/** Where backups are kept: BACKUP_DIR (an absolute path, for example a synced or external drive) or the app data folder. */
export function backupDir(env = process.env) {
  return env.BACKUP_DIR && path.isAbsolute(env.BACKUP_DIR) ? env.BACKUP_DIR : path.join(appDataDir(), "backups");
}

const pad = (n) => String(n).padStart(2, "0");
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Parents before children, so rows can be inserted without breaking links. Cycles and self links are tolerated. */
export function orderTables(tables, links) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of links) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const out = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)].every((p) => !left.has(p))).sort();
    if (!ready.length) { out.push(...[...left].sort()); break; }
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Read every table. `q(sql, params)` resolves to an array of row objects. */
export async function dumpDatabase(q, { now = new Date(), secret = null } = {}) {
  const names = (await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"))
    .map((r) => r.table_name)
    .filter((n) => IDENT.test(n) && !EXCLUDED_TABLES.includes(n));
  const links = await q("SELECT cl.relname AS child, pr.relname AS parent FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pr ON pr.oid = c.confrelid WHERE c.contype = 'f'");
  const order = orderTables(names, links);
  const tables = {};
  const counts = {};
  for (const name of order) {
    const columns = (await q("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [name])).map((r) => r.column_name);
    const rows = (await q(`SELECT * FROM "${name}"`)).map((r) => columns.map((c) => (r[c] instanceof Date ? r[c].toISOString() : r[c] ?? null)));
    tables[name] = { columns, rows };
    counts[name] = rows.length;
  }
  const body = JSON.stringify(tables);
  return {
    manifest: { format: BACKUP_FORMAT, app: "kestrel", created_at: now.toISOString(), order, counts, sha256: sha256(body), secret_included: !!secret },
    secret: secret || null,
    tables,
  };
}

/** Snapshot to bytes: gzip, then encrypt when a passphrase is given. */
export function encodeSnapshot(snapshot, passphrase = "") {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)));
  if (!passphrase) return gz;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ct]);
}

/** Bytes back to a snapshot, checking everything: encryption, format, and the checksum of the data. */
export function decodeSnapshot(buf, passphrase = "") {
  let gz = buf;
  if (buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!passphrase) throw new BackupError("This backup is encrypted. Set BACKUP_PASSPHRASE to the passphrase it was made with.");
    try {
      const salt = buf.subarray(5, 21);
      const iv = buf.subarray(21, 33);
      const tag = buf.subarray(33, 49);
      const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(passphrase, salt, 32), iv);
      decipher.setAuthTag(tag);
      gz = Buffer.concat([decipher.update(buf.subarray(49)), decipher.final()]);
    } catch {
      throw new BackupError("Wrong passphrase, or the file is damaged.");
    }
  }
  let snapshot;
  try {
    snapshot = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
  } catch {
    throw new BackupError("This is not a Kestrel backup, or it is damaged.");
  }
  const m = snapshot?.manifest;
  if (!m || m.app !== "kestrel" || m.format !== BACKUP_FORMAT || typeof snapshot.tables !== "object" || snapshot.tables === null) {
    throw new BackupError("This is not a Kestrel backup this version can read.");
  }
  if (sha256(JSON.stringify(snapshot.tables)) !== m.sha256) throw new BackupError("The backup does not match its checksum, so it is damaged.");
  for (const [name, n] of Object.entries(m.counts || {})) {
    if (snapshot.tables[name]?.rows?.length !== n) throw new BackupError(`The backup is incomplete (${name} is missing rows).`);
  }
  return snapshot;
}

export function listBackups(dir = backupDir()) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => BACKUP_NAME.test(n));
  } catch {
    return [];
  }
  return names.sort().reverse().map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, bytes: st.size, modified: st.mtime.toISOString(), encrypted: name.endsWith(".enc") };
  });
}

/** Keep the newest `keep` backups and delete the rest. Only files that look like backups are ever touched. */
export function pruneBackups(dir = backupDir(), keep = DEFAULT_KEEP) {
  const all = listBackups(dir);
  const doomed = all.slice(Math.max(1, keep));
  for (const b of doomed) fs.rmSync(path.join(dir, b.name), { force: true });
  return doomed.map((b) => b.name);
}

/** Make a backup file now. Written to a temporary name first, so a half written file is never mistaken for a backup. */
export async function createBackup({ q, dir = backupDir(), passphrase = process.env.BACKUP_PASSPHRASE || "", secret = null, now = new Date(), keep = DEFAULT_KEEP }) {
  const snapshot = await dumpDatabase(q, { now, secret });
  const bytes = encodeSnapshot(snapshot, passphrase);
  const name = `kestrel-backup-${stamp(now)}.kbk.${passphrase ? "enc" : "gz"}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, name + ".tmp");
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, name));
  } catch (err) {
    throw new BackupError(`Could not save the backup in ${dir} (${err.code || err.message}). Check the folder exists and has space.`);
  }
  pruneBackups(dir, keep);
  const rows = Object.values(snapshot.manifest.counts).reduce((a, b) => a + b, 0);
  return { name, bytes: bytes.length, encrypted: !!passphrase, createdAt: snapshot.manifest.created_at, tables: snapshot.manifest.order.length, rows };
}

export function readBackup(file, passphrase = process.env.BACKUP_PASSPHRASE || "") {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new BackupError("That backup file was not found.");
  }
  if (st.size > MAX_BYTES) throw new BackupError("That file is too large to be a Kestrel backup.");
  return decodeSnapshot(fs.readFileSync(file), passphrase);
}

/** Open a backup and check it end to end, without changing anything. */
export function verifyBackup(file, passphrase = process.env.BACKUP_PASSPHRASE || "") {
  try {
    const s = readBackup(file, passphrase);
    const rows = Object.values(s.manifest.counts).reduce((a, b) => a + b, 0);
    return { ok: true, createdAt: s.manifest.created_at, tables: s.manifest.order.length, rows, secretIncluded: s.manifest.secret_included };
  } catch (err) {
    if (err instanceof BackupError) return { ok: false, error: err.message };
    throw err;
  }
}

/** How fresh the newest backup is, and whether it is time for another. */
export function backupStatus(dir = backupDir(), now = new Date()) {
  const list = listBackups(dir);
  const newest = list[0]?.modified || null;
  const ageDays = newest ? (now.getTime() - Date.parse(newest)) / 86400000 : null;
  return { count: list.length, newest, ageDays, stale: ageDays === null || ageDays > STALE_DAYS };
}

/**
 * Fill an EMPTY database (one that has the tables but no rows) from a snapshot. Refuses anything else, so a restore
 * can never overwrite data. `q` is the same kind of function used for dumping.
 */
export async function restoreSnapshot(q, snapshot) {
  const names = snapshot.manifest.order.filter((n) => snapshot.tables[n]);
  for (const n of names) if (!IDENT.test(n)) throw new BackupError("The backup contains an unexpected table name.");
  const have = new Set((await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.table_name));
  for (const n of names) {
    if (!have.has(n)) throw new BackupError(`This database has no table called ${n}. Start Kestrel once against it first so it creates its tables.`);
    const [{ c }] = await q(`SELECT COUNT(*)::int AS c FROM "${n}"`);
    if (c > 0) throw new BackupError(`This database already has data in ${n}. A restore only fills an empty database.`);
    const cols = new Set((await q("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [n])).map((r) => r.column_name));
    for (const c2 of snapshot.tables[n].columns) if (!IDENT.test(c2) || !cols.has(c2)) throw new BackupError(`The backup has a column (${n}.${c2}) this database does not.`);
  }
  let rows = 0;
  for (const n of names) {
    const { columns, rows: data } = snapshot.tables[n];
    if (!data.length) continue;
    const sql = `INSERT INTO "${n}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`;
    for (const row of data) {
      await q(sql, row.map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v)));
      rows++;
    }
  }
  for (const n of names) {
    if (snapshot.tables[n].columns.includes("id")) await q(`SELECT setval(pg_get_serial_sequence('"${n}"', 'id'), COALESCE((SELECT MAX(id) FROM "${n}"), 0) + 1, false)`);
  }
  return { tables: names.length, rows };
}
