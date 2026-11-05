import { NextResponse } from "next/server";
import { BRAND, currentSession } from "@/lib/auth";
import { contactsForExport, listClients, listProjects } from "@/lib/store";
import { csvCell } from "@/lib/leadfilters";
import { formatCents } from "@/lib/crm";

// CSV exports of your own CRM records. The kind is an allowlist; anything else is a 404.
const KINDS = {
  contacts: {
    header: ["Name", "Email", "Phone", "City", "State", "Source", "Stage", "Website", "First seen"],
    rows: async () => (await contactsForExport(BRAND)).map((r) => [r.name, r.contact_email, r.phone, r.city, r.region, r.source, r.stage, r.website, r.first_seen_at]),
  },
  clients: {
    header: ["Name", "Email", "Phone", "Status", "Projects", "Quoted total", "Created"],
    rows: async () => (await listClients(BRAND)).map((c) => [c.name, c.email, c.phone, c.status, c.project_count, formatCents(Number(c.quoted_total)), c.created_at]),
  },
  projects: {
    header: ["Client", "Project", "Type", "Status", "Quoted", "Currency", "Start", "Target", "Created"],
    rows: async () => (await listProjects(BRAND)).map((p) => [p.client_name, p.name, p.type, p.status, p.quoted_amount_cents == null ? "" : (p.quoted_amount_cents / 100).toFixed(2), p.currency, p.start_on, p.target_on, p.created_at]),
  },
};

export async function GET(_request, { params }) {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  const { kind } = await params;
  const def = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!def) return new NextResponse("Not found.", { status: 404 });
  const lines = [def.header.map(csvCell).join(",")];
  for (const row of await def.rows()) lines.push(row.map(csvCell).join(","));
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kestrel-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
