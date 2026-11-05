// Pure matching rules for deciding whether a scanned business is the same place as an entry in
// an open business dataset (Overture Maps), so we can learn its real website. No database or
// network here. The rules are deliberately conservative: a wrong match would wrongly remove a
// genuine prospect, so a weak match is treated as "not found".
import { classifyWebsite } from "./sites.js";

const STOP = new Set(["the", "and", "of", "inc", "llc", "ltd", "co", "corp", "company", "incorporated", "at"]);

/** "Joe's Pizza & Subs, LLC" -> "joes pizza subs" (lowercase words, no punctuation, no filler words). */
export function nameTokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

export const normName = (name) => nameTokens(name).join("");

/** 0 to 1: how alike two business names are (shared words over all words). */
export function nameSimilarity(a, b) {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (!A.size || !B.size) return 0;
  if ([...A].join("") === [...B].join("")) return 1;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

export const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

/** Distance in metres between two latitude/longitude points. */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

/** Turn what a dataset gives us ("www.x.com", "http://x.com/") into a clean http(s) URL, or null. */
export function normalizeUrl(value) {
  let s = String(value || "").trim();
  if (!s || /\s/.test(s) || s.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** The best real website for a place: the first non-social site, else a social page, else nothing. */
export function bestWebsite(candidate) {
  const urls = [...(candidate.websites || [])].map(normalizeUrl).filter(Boolean);
  const site = urls.find((u) => classifyWebsite(u).kind === "site");
  if (site) return { url: site, kind: "site" };
  const social = [...urls, ...(candidate.socials || []).map(normalizeUrl).filter(Boolean)].find((u) => classifyWebsite(u).kind === "social");
  return social ? { url: social, kind: "social" } : null;
}

const NEAR_METERS = 250;
const NAME_MATCH = 0.8;

/**
 * Find the dataset entry that is the same business as `lead`, or null.
 *   lead:       { name, city, phone, lat?, lon? }
 *   candidates: [{ name, city, phones[], websites[], socials[], lat?, lon?, confidence }]
 * Accepted matches, best first:
 *   1. same phone number and a similar name (or close by)
 *   2. very similar name and close by (when both have coordinates)
 *   3. very similar name in the same city (when coordinates are missing)
 * Anything weaker is not a match.
 */
export function matchLead(lead, candidates) {
  const phone = digits10(lead.phone);
  const hasLead = Number.isFinite(lead.lat) && Number.isFinite(lead.lon);
  let best = null;
  const consider = (cand, how, rank) => {
    const score = rank * 10 + (cand.confidence || 0);
    if (!best || score > best.score) best = { candidate: cand, how, score };
  };
  for (const c of candidates) {
    const sim = nameSimilarity(lead.name, c.name);
    const hasCand = Number.isFinite(c.lat) && Number.isFinite(c.lon);
    const dist = hasLead && hasCand ? distanceMeters(lead.lat, lead.lon, c.lat, c.lon) : null;
    const near = dist !== null && dist <= NEAR_METERS;
    if (phone && (c.phones || []).some((p) => digits10(p) === phone) && (sim >= 0.5 || near)) {
      consider(c, "phone", 3);
    } else if (sim >= NAME_MATCH && near) {
      consider(c, "name and location", 2);
    } else if (sim >= NAME_MATCH && dist === null && lead.city && c.city && normName(lead.city) === normName(c.city)) {
      consider(c, "name and city", 1);
    }
  }
  return best;
}

/** Where to look for a lead's area: the place text of the search that found it, else its city and state. */
export function locationOfLead(lead) {
  const m = /\bin (.+)$/.exec(String(lead.search_label || ""));
  if (m) return m[1].trim();
  return [lead.city, lead.region].filter(Boolean).join(", ") || null;
}
