// Brings scan results from the old in-project database (data/pglite) into your current database
// (in the app data folder), keeping your current login. Non-destructive:
//   - your current database is backed up first (a folder next to it ending in .backup-<time>)
//   - the old folder is only read from a temporary copy, never changed
//   - rows that already exist are skipped, nothing is overwritten
// Stop Kestrel first (Ctrl+C), then run:   node scripts/recover-legacy-data.mjs --yes
// Without --yes it only reports what it would bring over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appDataDir } from "../lib/appdir.js";
import { openLocal } from "../lib/db.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const legacyDir = opt("--legacy") || path.join(process.cwd(), "data", "pglite");
const currentDir = opt("--current") || path.join(appDataDir(), "pglite");
const apply = flag("--yes");

// Parents first, so foreign keys line up.
const TABLES = ["campaigns", "leads", "drafts", "area_scans", "searches", "runs", "suppressions"];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

if (!fs.existsSync(legacyDir)) fail(`No old database found at ${legacyDir}. Run this from the kestrel project folder.`);
if (!fs.existsSync(currentDir)) fail(`No current database found at ${currentDir}. Start Kestrel once, then stop it and try again.`);

// Refuse while another copy of the app is using the current database.
try {
  const pid = Number(fs.readFileSync(currentDir + ".lock", "utf8"));
  if (pid && pid !== process.pid && pidAlive(pid)) fail(`Kestrel (process ${pid}) is still running. Stop it with Ctrl+C, then run this again.`);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

// Read the old database from a temporary copy so the original stays exactly as it is.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-recover-"));
const legacyCopy = path.join(tmp, "legacy", "pglite");
fs.mkdirSync(path.dirname(legacyCopy), { recursive: true });
fs.cpSync(legacyDir, legacyCopy, { recursive: true });
fs.rmSync(path.join(legacyCopy, "postmaster.pid"), { force: true });

if (apply) {
  const backup = `${currentDir}.backup-${Date.now()}`;
  fs.cpSync(currentDir, backup, { recursive: true });
  fs.rmSync(path.join(backup, "postmaster.pid"), { force: true });
  console.log(`Backed up your current database to ${backup}`);
}

const legacy = await openLocal(legacyCopy);
const current = await openLocal(currentDir);

async function columns(db, table) {
  const r = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [table]);
  return r.rows.map((x) => x.column_name);
}

const report = [];
for (const table of TABLES) {
  const [a, b] = [await columns(legacy, table), await columns(current, table)];
  const cols = a.filter((c) => b.includes(c));
  if (!cols.length) { report.push(`${table}: skipped (not in both)`); continue; }
  const rows = (await legacy.query(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table}`)).rows;
  let added = 0;
  if (apply) {
    for (const row of rows) {
      const res = await current.query(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT DO NOTHING`,
        cols.map((c) => row[c]),
      );
      added += res.affectedRows ?? 0;
    }
    if (cols.includes("id")) {
      await current.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${table}), 1))`);
    }
  }
  report.push(`${table}: ${rows.length} in the old database${apply ? `, ${added} brought over` : ""}`);
}

if (apply) {
  await current.query("UPDATE runs SET status = 'interrupted', finished_at = $1, error = COALESCE(error, 'Recovered from the old database after the app was stopped.') WHERE status = 'running'", [new Date().toISOString()]);
}

console.log(report.join("\n"));
const now = (await current.query("SELECT (SELECT COUNT(*) FROM leads)::int AS leads, (SELECT COUNT(*) FROM users)::int AS users")).rows[0];
console.log(`\nYour current database now has ${now.leads} leads and ${now.users} user(s).${apply ? "" : "\nThis was a dry run. Run again with --yes to bring the data over."}`);

await legacy.close();
await current.close();
// Release the lock files this run created so the next start of Kestrel is not blocked or confused.
fs.rmSync(currentDir + ".lock", { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
