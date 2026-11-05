// Short tracked links and signed media links. Pure helpers, no database.
import crypto from "node:crypto";
import { appSecret } from "../secret.js";
import { baseUrl } from "../tokens.js";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alike characters
export function newCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const validCode = (c) => typeof c === "string" && /^[a-km-z2-9]{6,12}$/.test(c);

const ALWAYS = ["aquiladigital.net", "www.aquiladigital.net", "apps.apple.com", "play.google.com"];
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };

/** Hosts a tracked link may point at: the app's own website and store link, Aquila's site, the app stores, plus any the owner listed. */
export function allowedHosts(app) {
  const extra = String(app.link_hosts || "").split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...ALWAYS, hostOf(app.website), hostOf(app.store_url), ...extra].filter(Boolean))];
}

/** https only, and the host must be on the allowlist. Returns { ok, url } or { ok: false, error }. */
export function validateTarget(url, app) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return { ok: false, error: "The link is not a valid web address." }; }
  if (u.protocol !== "https:") return { ok: false, error: "Links must start with https://." };
  if (u.username || u.password) return { ok: false, error: "Links cannot contain a username or password." };
  if (!allowedHosts(app).includes(u.hostname.toLowerCase())) {
    return { ok: false, error: `${u.hostname} is not on this app's link list. Add it under the app's allowed link hosts first.` };
  }
  return { ok: true, url: u.toString() };
}

/** Adds source parameters to the destination. campaign is the variant id, so a visit can be traced to one post. */
export function withUtm(target, { platform, variantId }) {
  const u = new URL(target);
  u.searchParams.set("utm_source", platform);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", `post-${variantId}`);
  return u.toString();
}

export const shortUrl = (code) => `${baseUrl()}/l/${code}`;

// ---- signed media links: how a platform fetches an image at publish time, without the image being public otherwise ----
const sign = (id, exp) => crypto.createHmac("sha256", appSecret()).update(`social-media|${id}|${exp}`).digest("base64url");
export function signMedia(assetId, ttlSeconds = 3600, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  return `${assetId}.${exp}.${sign(assetId, exp)}`;
}
export function verifyMedia(token, nowMs = Date.now()) {
  const [id, exp, sig] = String(token || "").split(".");
  if (!/^\d+$/.test(id || "") || !/^\d+$/.test(exp || "") || !sig) return null;
  if (Number(exp) < Math.floor(nowMs / 1000)) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(id, exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? Number(id) : null;
}
export const mediaUrl = (assetId, ttl) => `${baseUrl()}/sm/${signMedia(assetId, ttl)}`;
