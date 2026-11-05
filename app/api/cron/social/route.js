import { NextResponse } from "next/server";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { cronAuthorized } from "@/lib/cronauth";
import { allow } from "@/lib/ratelimit";
import { publishDue } from "@/lib/social/service";

// Called on a schedule (Windows Task Scheduler locally, a cron job once hosted) with the CRON_SECRET bearer token.
// Publishes approved posts whose time has come. Every rule is re-checked inside publishDue.
export async function POST(request) {
  const ok = cronAuthorized(request);
  if (ok === null) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!allow("cron-social", 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    return NextResponse.json(await publishDue(DEFAULT_BRAND_ID), { status: 200 });
  } catch {
    return NextResponse.json({ error: "The publish run failed." }, { status: 500 });
  }
}
