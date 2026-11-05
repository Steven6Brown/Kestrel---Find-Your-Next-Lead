import { NextResponse } from "next/server";
import { validCode } from "@/lib/social/links";
import { recordClick } from "@/lib/socialstore";
import { allow } from "@/lib/ratelimit";

// Public short link. It only ever redirects to a destination that was checked against the app's allowlist when the
// post was made, looked up by code. Nothing in the request chooses the destination, so it cannot be an open redirect.
// Only a total is counted: no address, browser or cookie is stored.
export async function GET(request, { params }) {
  const { code } = await params;
  if (!validCode(code)) return new NextResponse("Not found.", { status: 404 });
  const key = `l:${(request.headers.get("x-forwarded-for") || "local").split(",")[0].trim()}`;
  if (!allow(key, 120, 60_000)) return new NextResponse("Too many requests.", { status: 429 });
  const target = await recordClick(code);
  if (!target) return new NextResponse("Not found.", { status: 404 });
  return NextResponse.redirect(target, 302);
}
