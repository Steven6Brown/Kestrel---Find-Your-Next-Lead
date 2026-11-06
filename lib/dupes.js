// Finding contacts that are probably the same business listed twice (for example the same bakery from two map
// entries, or a scanned business and one you typed in). Pure rules, no database.
//
// The rules are deliberately cautious, because merging two different businesses loses data:
//   - two entries far apart on the map (more than 250 metres) are different places, whatever their names
//   - a shared phone or website only counts together with a similar name (chains share both)
//   - a person you dismissed as "not duplicates" is never offered again
import { distanceMeters, digits10, nameSimilarity, normName } from "./matchsites.js";
import { classifyWebsite, hostOf } from "./sites.js";

export const FAR_METERS = 250;
const MAX_BUCKET = 60; // a bucket this big is a chain or a data glitch, not a duplicate

const hasCoords = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lon);
const farApart = (a, b) => hasCoords(a) && hasCoords(b) && distanceMeters(a.lat, a.lon, b.lat, b.lon) > FAR_METERS;
const emailOf = (l) => String(l.contact_email || "").trim().toLowerCase();
const cityOf = (l) => normName(l.city || "");
/** The host of a real website (social pages and directories do not identify a business). */
export const siteHost = (l) => (l.website && classifyWebsite(l.website).kind === "site" ? hostOf(l.website) : "");
/** The page on that website, "" for the home page. Two stores of a chain share a host but not a page. */
const sitePath = (l) => {
  try {
    return new URL(l.website).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return "";
  }
};
const phone10 = (l) => (digits10(l.phone).length === 10 ? digits10(l.phone) : "");
/** Two entries that disagree on phone number or website cannot be one business, whatever their names say. */
function conflicts(a, b) {
  if (phone10(a) && phone10(b) && phone10(a) !== phone10(b)) return true;
  const ha = siteHost(a);
  const hb = siteHost(b);
  if (!ha || !hb) return false;
  if (ha !== hb) return true;
  return !!sitePath(a) && !!sitePath(b) && sitePath(a) !== sitePath(b);
}

/** Why two contacts look like one business, or null when they do not. */
export function duplicateReason(a, b) {
  if (!a || !b || a.id === b.id) return null;
  const sim = nameSimilarity(a.name, b.name);
  if (farApart(a, b)) return null;
  if (cityOf(a) && cityOf(b) && cityOf(a) !== cityOf(b)) return null; // known to be in different cities: not one business
  const ea = emailOf(a);
  if (ea && ea === emailOf(b) && sim >= 0.5) return "Same email address";
  const pa = digits10(a.phone);
  if (pa.length === 10 && pa === digits10(b.phone) && sim >= 0.5) return "Same phone number";
  const na = normName(a.name);
  if (conflicts(a, b)) return null; // different phone numbers or different store pages: two places, not one
  if (na && na === normName(b.name) && (!cityOf(a) || !cityOf(b) || cityOf(a) === cityOf(b))) return "Same name in the same place";
  const ha = siteHost(a);
  if (ha && ha === siteHost(b) && sim >= 0.6) return "Same website";
  return null;
}

/** How far along a contact is, for choosing which record to keep: a client first, then the furthest stage. */
const STAGE_RANK = { new: 0, contacted: 1, replied: 2, meeting_booked: 3, proposal_sent: 4, won: 5 };
export const stageRank = (stage) => STAGE_RANK[stage] ?? 0;

/** Suggested record to keep: has a client, then furthest along, then has an email, then the oldest. */
export function pickSurvivor(leads) {
  const score = (l) => (l.has_client ? 100 : 0) + stageRank(l.stage) * 10 + (emailOf(l) ? 1 : 0);
  return [...leads].sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
}

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Groups of contacts that look like the same business. `leads` need id, name, city, phone, contact_email, website, lat, lon.
 * `dismissed` is a set of "smallerId:largerId" strings for pairs a person said are not duplicates.
 * Candidates are only compared inside shared buckets (same name, phone, email, or website host), so this stays fast
 * on thousands of contacts.
 */
export function findDuplicateGroups(leads, dismissed = new Set()) {
  const buckets = new Map();
  const put = (key, id) => {
    if (!key) return;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(id);
  };
  for (const l of leads) {
    put(normName(l.name) && `n:${normName(l.name)}`, l.id);
    put(digits10(l.phone).length === 10 && `p:${digits10(l.phone)}`, l.id);
    put(emailOf(l) && `e:${emailOf(l)}`, l.id);
    put(siteHost(l) && `w:${siteHost(l)}`, l.id);
  }
  const byId = new Map(leads.map((l) => [l.id, l]));
  const parent = new Map(leads.map((l) => [l.id, l.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const seen = new Set();
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > MAX_BUCKET) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairKey(ids[i], ids[j]);
        if (seen.has(k)) continue;
        seen.add(k);
        if (dismissed.has(k)) continue;
        if (!duplicateReason(byId.get(ids[i]), byId.get(ids[j]))) continue;
        parent.set(find(ids[i]), find(ids[j]));
      }
    }
  }
  const groups = new Map();
  for (const l of leads) (groups.get(find(l.id)) || groups.set(find(l.id), []).get(find(l.id))).push(l.id);
  const reasonsFor = (ids) => {
    const out = new Set();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const r = duplicateReason(byId.get(ids[i]), byId.get(ids[j]));
      if (r && !dismissed.has(pairKey(ids[i], ids[j]))) out.add(r);
    }
    return [...out];
  };
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({ ids: ids.sort((a, b) => a - b), reasons: reasonsFor(ids) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.ids[0] - b.ids[0]);
}

/** An index of contacts for matching new ones against them quickly, using the same shared buckets as the group finder. */
export function buildIndex(leads = []) {
  const buckets = new Map();
  const index = { buckets, add(l) { for (const key of keysOf(l)) (buckets.get(key) || buckets.set(key, []).get(key)).push(l); } };
  for (const l of leads) index.add(l);
  return index;
}

function keysOf(l) {
  const keys = [];
  if (normName(l.name)) keys.push(`n:${normName(l.name)}`);
  if (digits10(l.phone).length === 10) keys.push(`p:${digits10(l.phone)}`);
  if (emailOf(l)) keys.push(`e:${emailOf(l)}`);
  if (siteHost(l)) keys.push(`w:${siteHost(l)}`);
  return keys;
}

/** The first contact in the index that looks like the same business as `candidate`, with why, or null. */
export function findMatch(index, candidate) {
  for (const key of keysOf(candidate)) {
    for (const other of index.buckets.get(key) || []) {
      const reason = duplicateReason(candidate, other);
      if (reason) return { lead: other, reason };
    }
  }
  return null;
}

export { pairKey };
