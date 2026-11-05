import { NextResponse } from "next/server";

// Protects the dashboard and all server actions with HTTP Basic Auth.
// Public paths (excluded in the matcher): hosted mockups, unsubscribe flow, legal pages.

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Admin password is not configured.", { status: 503 });
  }
  const user = process.env.ADMIN_USER || "admin";
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(":");
      if (i > -1 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), password)) {
        return NextResponse.next();
      }
    } catch {
      /* fall through to 401 */
    }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SiteScout", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!m/|unsubscribe|api/unsubscribe|privacy|terms|accessibility|_next/|favicon.ico|robots.txt).*)"],
};
