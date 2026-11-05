import { NextResponse } from "next/server";
import { BRAND, currentSession } from "@/lib/auth";
import { listMeetings } from "@/lib/store";
import { buildIcs } from "@/lib/ics";
import { MEETING_LOCATIONS, labelOf } from "@/lib/crm";

// Download your meetings (the last 30 days and the next 180) as an .ics file. Import it into
// Google Calendar or any calendar app. Meetings have no end time in Kestrel, so each is 30 minutes.
export async function GET() {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  const now = Date.now();
  const rows = await listMeetings(BRAND, {
    fromIso: new Date(now - 30 * 86400000).toISOString(), toIso: new Date(now + 180 * 86400000).toISOString(), limit: 2000,
  });
  const ics = buildIcs(rows.map((m) => ({
    uid: `meeting-${m.id}@kestrel`, startIso: m.starts_at, durationMinutes: 30,
    summary: `${m.title} with ${m.lead_name || m.client_name || "contact"}`,
    location: labelOf(MEETING_LOCATIONS, m.location), description: m.notes || "", status: m.status,
  })));
  return new NextResponse(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="kestrel-meetings.ics"', "Cache-Control": "no-store" },
  });
}
