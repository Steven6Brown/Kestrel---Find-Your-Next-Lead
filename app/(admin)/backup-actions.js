"use server";

import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { appSecret } from "@/lib/secret";
import { BACKUP_NAME, BackupError, backupDir, createBackup, verifyBackup } from "@/lib/backup";
import { audit } from "@/lib/users";

const ROLES = ["owner", "admin"];
const back = (msg, type = "ok") => redirect(`/settings/backups?msg=${encodeURIComponent(msg)}&type=${type}`);

/** Save a full backup now. */
export async function createBackupAction() {
  const user = await requireUser({ roles: ROLES });
  let result;
  let problem = "";
  try {
    result = await createBackup({ q: (s, p) => query(s, p), secret: process.env.APP_SECRET ? null : appSecret() });
    await audit(BRAND, user.id, "backup_created", result.name, (await clientInfo()).ip);
  } catch (err) {
    if (!(err instanceof BackupError)) throw err;
    problem = err.message;
  }
  revalidatePath("/", "layout");
  if (problem) back(problem, "bad");
  back(`Backup saved: ${result.name} (${result.tables} tables, ${result.rows.toLocaleString()} rows${result.encrypted ? ", encrypted" : ""}).`);
}

/** Open a backup and check it end to end, without changing anything. */
export async function verifyBackupAction(formData) {
  await requireUser({ roles: ROLES });
  const name = String(formData.get("name") || "");
  if (!BACKUP_NAME.test(name)) back("That is not a backup file name.", "bad");
  const r = verifyBackup(path.join(backupDir(), name));
  if (!r.ok) back(`${name}: ${r.error}`, "bad");
  back(`${name} is good: ${r.tables} tables and ${r.rows.toLocaleString()} rows, all matching their checksum.`);
}
