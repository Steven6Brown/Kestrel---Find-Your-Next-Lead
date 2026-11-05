// Where the app keeps its local files (database, generated secret, mail outbox).
// Deliberately NOT inside the project folder: this project often lives under OneDrive, and
// cloud sync locking or rewriting a database's many small files is a known way to damage it.
// Override with KESTREL_DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function appDataDir() {
  if (process.env.KESTREL_DATA_DIR) return process.env.KESTREL_DATA_DIR;
  const base =
    process.env.LOCALAPPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"));
  return path.join(base, "Kestrel");
}

/**
 * Earlier versions kept the database in <project>/data. On the first start of this version,
 * copy it (and the matching secret, which two-factor secrets depend on) to the app data
 * folder. The old folder is left untouched as a backup. Does nothing if the new location
 * already has a database.
 */
export function migrateLegacyData({ legacyRoot = path.join(process.cwd(), "data"), newRoot = appDataDir() } = {}) {
  const oldDb = path.join(legacyRoot, "pglite");
  const newDb = path.join(newRoot, "pglite");
  if (!fs.existsSync(oldDb) || fs.existsSync(newDb)) return false;
  fs.mkdirSync(newRoot, { recursive: true });
  fs.cpSync(oldDb, newDb, { recursive: true });
  fs.rmSync(path.join(newDb, "postmaster.pid"), { force: true }); // stale lock left by an unclean stop
  const oldSecret = path.join(legacyRoot, ".secret");
  const newSecret = path.join(newRoot, ".secret");
  if (fs.existsSync(oldSecret) && !fs.existsSync(newSecret)) fs.copyFileSync(oldSecret, newSecret);
  console.warn("[kestrel] Moved your existing data to " + newRoot + " (the old copy in the project folder was kept as a backup).");
  return true;
}
