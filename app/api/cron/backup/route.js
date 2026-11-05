import { NextResponse } from "next/server";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { query } from "@/lib/db";
import { appSecret } from "@/lib/secret";
import { BackupError, createBackup } from "@/lib/backup";
import { cronAuthorized } from "@/lib/cronauth";
import { audit } from "@/lib/users";
import { allow } from "@/lib/ratelimit";

// Called by Windows Task Scheduler (scripts/run-backup.ps1). Public path, protected by the same bearer secret as
// scheduled scans. Saves one backup and answers with its name and size.
export async function POST(request) {
  const ok = cronAuthorized(request);
  if (ok === null) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!allow("cron-backup", 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const r = await createBackup({ q: (s, p) => query(s, p), secret: process.env.APP_SECRET ? null : appSecret() });
    await audit(DEFAULT_BRAND_ID, null, "backup_created", `${r.name} (scheduled)`, "");
    return NextResponse.json({ name: r.name, bytes: r.bytes, rows: r.rows, encrypted: r.encrypted }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof BackupError ? err.message : "The backup failed." }, { status: 500 });
  }
}
