import { NextResponse } from "next/server";
import { currentSession, BRAND } from "@/lib/auth";
import { leadsForExport } from "@/lib/store";
import { csvCell, parseFilters } from "@/lib/leadfilters";
import { mockupUrl } from "@/lib/tokens";

// CSV of whatever the Leads page is currently filtered to (up to 5,000 rows).
export async function GET(request) {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  const f = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await leadsForExport(BRAND, f, 5000);
  const header = ["Name", "Type", "City", "State", "Phone", "Website", "Website kind", "Address", "Source link", "Status", "Website check", "Concept page"];
  const lines = [header.map(csvCell).join(",")];
  for (const l of rows) {
    lines.push([
      l.name, l.category_label, l.city, l.region, l.phone, l.website, l.website_kind, l.address, l.maps_url, l.status,
      l.place_id?.startsWith("osm:") ? l.site_check : "google listing",
      l.bucket === "no_website" ? mockupUrl(l.mockup_token) : "",
    ].map(csvCell).join(","));
  }
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kestrel-leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}
