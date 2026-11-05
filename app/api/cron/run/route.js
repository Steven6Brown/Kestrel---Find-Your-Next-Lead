import crypto from "node:crypto";
import { NextResponse, after } from "next/server";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { getCampaign, listCampaigns } from "@/lib/store";
import { startRun } from "@/lib/runner";
import { allow } from "@/lib/ratelimit";

// Called by Windows Task Scheduler (scripts/run-campaign.ps1). Public path, protected by a
// bearer secret so only your scheduled task can start scans. Responds right away (202) and
// finishes the scan in the background; results appear on the dashboard under Recent runs.
function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return null; // not configured
  const given = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  const ok = authorized(request);
  if (ok === null) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!ok) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!allow("cron", 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const idParam = new URL(request.url).searchParams.get("campaign");
  const id = idParam === null ? null : Number(idParam);
  if (id !== null && !Number.isInteger(id)) return NextResponse.json({ error: "Bad campaign id." }, { status: 400 });
  const campaigns = id === null
    ? (await listCampaigns(DEFAULT_BRAND_ID)).filter((c) => c.enabled && c.frequency !== "manual")
    : [await getCampaign(DEFAULT_BRAND_ID, id)].filter(Boolean);
  if (!campaigns.length) return NextResponse.json({ error: "No matching campaign." }, { status: 404 });

  const started = [];
  for (const campaign of campaigns) {
    if (!campaign.enabled) { started.push({ campaign: campaign.id, skipped: "disabled" }); continue; }
    const r = await startRun({ brandId: DEFAULT_BRAND_ID, campaign, trigger: "schedule" });
    if (r.skipped) { started.push({ campaign: campaign.id, skipped: r.reason }); continue; }
    after(() => r.done);
    started.push({ campaign: campaign.id, run: r.runId });
  }
  return NextResponse.json({ started }, { status: 202 });
}
