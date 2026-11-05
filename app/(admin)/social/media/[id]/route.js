import { NextResponse } from "next/server";
import { currentSession, BRAND } from "@/lib/auth";
import { getAsset } from "@/lib/socialstore";

// Signed in preview of a stored graphic. Brand scoped, so an id from another tenant is a 404.
export async function GET(_request, { params }) {
  const s = await currentSession();
  if (!s || (s.mfa_enabled && !s.mfa_passed)) return new NextResponse("Sign in required.", { status: 401 });
  const { id } = await params;
  const a = /^\d+$/.test(id) ? await getAsset(BRAND, Number(id)) : null;
  if (!a) return new NextResponse("Not found.", { status: 404 });
  return new NextResponse(a.data, { headers: { "Content-Type": a.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
