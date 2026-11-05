// Restore a Kestrel backup into a NEW, empty data folder. It never touches your current data.
//
//   node scripts/restore-backup.mjs "<backup file>" "<new folder>"
//   node scripts/restore-backup.mjs "<backup file>" --check        (only check the backup, change nothing)
//
// If the backup is encrypted, set BACKUP_PASSPHRASE first (in PowerShell: $env:BACKUP_PASSPHRASE = "...").
// Afterwards add KESTREL_DATA_DIR=<new folder> to .env.local and start Kestrel.
import fs from "node:fs";
import path from "node:path";
import { openLocal } from "../lib/db.js";
import { BackupError, readBackup, restoreSnapshot } from "../lib/backup.js";

const [file, target, flag] = process.argv.slice(2);
const checkOnly = flag === "--check" || target === "--check";
if (!file || (!checkOnly && !target)) {
  console.error('Usage: node scripts/restore-backup.mjs "<backup file>" "<new folder>"   (or add --check to only check it)');
  process.exit(2);
}

try {
  const snapshot = readBackup(path.resolve(file));
  const rows = Object.values(snapshot.manifest.counts).reduce((a, b) => a + b, 0);
  console.log(`Backup made ${snapshot.manifest.created_at}: ${snapshot.manifest.order.length} tables, ${rows.toLocaleString()} rows. Checksum matches.`);
  if (checkOnly) process.exit(0);

  const dir = path.resolve(target);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new BackupError(`${dir} is not empty. Choose a new folder so nothing is overwritten.`);
  fs.mkdirSync(dir, { recursive: true });
  const db = await openLocal(path.join(dir, "pglite"));
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
  const result = await restoreSnapshot(q, snapshot);
  await db.close();
  if (snapshot.secret) fs.writeFileSync(path.join(dir, ".secret"), snapshot.secret, { mode: 0o600 });
  console.log(`Restored ${result.rows.toLocaleString()} rows in ${result.tables} tables into ${dir}.`);
  if (!snapshot.secret) console.log("This backup does not contain the app secret, so set APP_SECRET to the same value you used before, or two factor sign in will not work.");
  console.log(`\nNext: stop Kestrel, add this line to .env.local, then start Kestrel again:\n  KESTREL_DATA_DIR=${dir}`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof BackupError ? err.message : err);
  process.exit(1);
}
