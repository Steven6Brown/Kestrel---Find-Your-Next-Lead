// Shared check for the endpoints the Windows Task Scheduler calls (scans and backups). They sit outside the sign in
// gate on purpose, so each one is protected by a bearer secret (CRON_SECRET, 16 or more characters) instead.
import crypto from "node:crypto";

/** true: the secret matched. false: it did not. null: CRON_SECRET is not set up, so the endpoint is switched off. */
export function cronAuthorized(request, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < 16) return null;
  const given = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
