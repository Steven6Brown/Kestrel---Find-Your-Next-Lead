import { NextResponse } from "next/server";

// First gate: anything outside the public paths needs a session cookie, otherwise the visitor
// is sent to sign in. The cookie is only checked for presence here; every page and server
// action validates the session against the database (lib/auth.js requireUser).
export function proxy(request) {
  if (request.cookies.get("ss_session")?.value) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "no-store"); // signed-in pages are never cached
    return res;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(url);
  }
  return new NextResponse("Authentication required.", { status: 401 });
}

// Public: hosted mockups, unsubscribe, scheduler endpoint (bearer secret), sign-in and recovery
// pages, legal pages, brand assets.
export const config = {
  matcher: ["/((?!m/|unsubscribe|api/unsubscribe|api/cron|login|forgot|reset|accept|setup|privacy|terms|accessibility|brands/|_next/|favicon.ico|icon.svg|robots.txt).*)"],
};
