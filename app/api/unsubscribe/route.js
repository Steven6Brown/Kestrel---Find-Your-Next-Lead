import { NextResponse } from "next/server";
import { verifyUnsubscribe } from "@/lib/tokens";
import { addSuppression } from "@/lib/store";
import { listBrandIds } from "@/config/brands";
import { allow } from "@/lib/ratelimit";

// Public endpoint (also the RFC 8058 one-click target). The signed token proves the
// link was issued for this exact address, so no login is needed.
function params(request) {
  const u = new URL(request.url).searchParams;
  return { b: u.get("b") || "", e: (u.get("e") || "").slice(0, 254), s: u.get("s") || "" };
}

export async function GET(request) {
  const url = new URL("/unsubscribe", request.url);
  url.search = new URL(request.url).search;
  return NextResponse.redirect(url, 303);
}

export async function POST(request) {
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (!allow(`unsub:${ip}`, 20, 60_000)) return new NextResponse("Too many requests.", { status: 429 });
  const { b, e, s } = params(request);
  if (!listBrandIds().includes(b) || !verifyUnsubscribe(b, e, s)) {
    return new NextResponse("This opt-out link is not valid.", { status: 400 });
  }
  await addSuppression(b, e, "unsubscribe link");
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (wantsHtml) return NextResponse.redirect(new URL("/unsubscribe/done", request.url), 303);
  return new NextResponse("You have been unsubscribed.", { status: 200 });
}
