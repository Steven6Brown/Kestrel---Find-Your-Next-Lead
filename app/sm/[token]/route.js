import { NextResponse } from "next/server";
import { verifyMedia } from "@/lib/social/links";
import { getAssetBySignedId } from "@/lib/socialstore";
import { allow } from "@/lib/ratelimit";

// Public, but only with a signed, expiring token made at publish time. This is how Instagram and Facebook fetch an
// image. Anything else (bad signature, expired, unknown id) is the same plain 404.
export async function GET(request, { params }) {
  if (!allow(`sm:${request.headers.get("x-forwarded-for") || "local"}`, 60, 60_000)) return new NextResponse("Too many requests.", { status: 429 });
  const { token } = await params;
  const id = verifyMedia(token);
  const a = id ? await getAssetBySignedId(id) : null;
  if (!a) return new NextResponse("Not found.", { status: 404 });
  return new NextResponse(a.data, { headers: { "Content-Type": a.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
