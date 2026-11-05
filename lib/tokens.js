// Signed unsubscribe links. HMAC-SHA256 over brand + email so a link cannot be
// forged or reused to suppress a different address.
import crypto from "node:crypto";
import { appSecret } from "./secret.js";

const secret = () => appSecret();

export function signUnsubscribe(brandId, email) {
  return crypto
    .createHmac("sha256", secret())
    .update(`unsub|${brandId}|${String(email).trim().toLowerCase()}`)
    .digest("base64url");
}

export function verifyUnsubscribe(brandId, email, sig) {
  if (!brandId || !email || !sig) return false;
  const expected = Buffer.from(signUnsubscribe(brandId, email));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function baseUrl() {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function isPublicHttps(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function mockupUrl(token) {
  return `${baseUrl()}/m/${token}`;
}

export function unsubscribeUrl(brandId, email, path = "/unsubscribe") {
  const q = new URLSearchParams({ b: brandId, e: String(email).trim().toLowerCase(), s: signUnsubscribe(brandId, email) });
  return `${baseUrl()}${path}?${q.toString()}`;
}
