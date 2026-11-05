import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { isManager } from "@/lib/auth";
import { BACKUP_NAME, backupDir } from "@/lib/backup";

// Download one backup file. Owners and admins only, and only a name that looks exactly like a backup,
// so no other file on the computer can be asked for.
export async function GET(request) {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  if (!isManager(s)) return new NextResponse("Owners and admins only.", { status: 403 });
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!BACKUP_NAME.test(name)) return new NextResponse("Not a backup file.", { status: 400 });
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(backupDir(), name));
  } catch {
    return new NextResponse("That backup was not found.", { status: 404 });
  }
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
