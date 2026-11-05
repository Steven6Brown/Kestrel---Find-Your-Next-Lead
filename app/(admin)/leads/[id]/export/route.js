import { NextResponse } from "next/server";
import { BRAND, currentSession, isManager } from "@/lib/auth";
import { contactExport } from "@/lib/privacy";
import { audit } from "@/lib/users";

// Everything Kestrel holds about one contact, as a JSON file. Owners and admins only, and every export is logged.
export async function GET(_request, { params }) {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  if (!isManager(s)) return new NextResponse("Owners and admins only.", { status: 403 });
  const { id } = await params;
  const leadId = Number(id);
  const data = Number.isInteger(leadId) && leadId > 0 ? await contactExport(BRAND, leadId) : null;
  if (!data) return new NextResponse("That contact was not found.", { status: 404 });
  await audit(BRAND, s.id, "contact_exported", `contact ${leadId}`, "");
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kestrel-contact-${leadId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
