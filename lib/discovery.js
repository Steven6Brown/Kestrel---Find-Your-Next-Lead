// Phase 1: query Places for every (category x location) combination, dedupe on
// Google Place ID, and split into no-website and has-website buckets.
import { searchPlaces } from "./places.js";
import { AREA_FAMILIES, searchArea, searchOverpass } from "./overpass.js";
import { freshAreaScans, markAreaScan, upsertPlace, recordSearch } from "./store.js";

// Free OpenStreetMap is the default. Set DISCOVERY_PROVIDER=google to use Places (paid).
export const provider = () => (process.env.DISCOVERY_PROVIDER === "google" ? "google" : "osm");
const defaultSearch = () => (provider() === "google" ? searchPlaces : searchOverpass);

// A scan never runs forever: it stops starting new searches after this long, and gives up early
// if the free map servers keep failing.
export const RUN_DEADLINE_MS = 25 * 60 * 1000;
export const MAX_CONSECUTIVE_FAILURES = 3;

export const MAX_COMBOS_PER_RUN = process.env.DISCOVERY_PROVIDER === "google" ? 20 : 40; // google: each search is billed

export async function runDiscovery({
  brandId,
  locations,
  categories,
  maxPages = 1,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  search = defaultSearch(),
  onProgress = async () => {},
  deadlineMs = RUN_DEADLINE_MS,
  pauseMs = 0,
}) {
  const combos = [];
  for (const category of categories) for (const location of locations) combos.push({ category, location });
  if (combos.length > MAX_COMBOS_PER_RUN) {
    throw new Error(
      `That is ${combos.length} searches. The limit is ${MAX_COMBOS_PER_RUN} per run to protect your Google bill. Split it up.`,
    );
  }
  const summary = { searches: 0, found: 0, created: 0, noWebsite: 0, hasWebsite: 0, errors: [], total: combos.length, attempted: 0, stopped: null };
  const started = Date.now();
  let streak = 0;
  await onProgress({ ...summary });
  for (const { category, location } of combos) {
    if (Date.now() - started > deadlineMs) {
      summary.stopped = `Stopped after the ${Math.round(deadlineMs / 60000)} minute limit with ${summary.attempted} of ${combos.length} searches done. Run it again to continue; finished results are already saved.`;
      break;
    }
    if (streak >= MAX_CONSECUTIVE_FAILURES) {
      summary.stopped = `Stopped after ${MAX_CONSECUTIVE_FAILURES} searches in a row failed (the free map servers look busy). ${summary.attempted} of ${combos.length} were tried. Try again later.`;
      break;
    }
    if (summary.attempted > 0 && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    const query = `${category} in ${location}`;
    summary.attempted++;
    try {
      const places = await search({ apiKey, textQuery: query, maxPages, location, category });
      let created = 0;
      for (const p of places) {
        const r = await upsertPlace(brandId, p, query);
        if (r.created) created++;
        if (p.bucket === "no_website") summary.noWebsite++;
        else summary.hasWebsite++;
      }
      summary.searches++;
      summary.found += places.length;
      summary.created += created;
      await recordSearch(brandId, { query, results: places.length, new_leads: created });
      streak = 0;
    } catch (err) {
      streak++;
      summary.errors.push(`${query}: ${err.message}`);
      await recordSearch(brandId, { query, error: err.message });
    }
    await onProgress({ ...summary });
  }
  return summary;
}

export const AREA_FRESH_DAYS = 7;

/**
 * Scans every business in each chosen area (no business type needed). The work is split into
 * (area x family) parts. Parts scanned within the last week are skipped, so a run that stopped
 * at its time limit simply continues where it left off the next time.
 */
export async function runAreaDiscovery({
  brandId,
  campaignId,
  locations,
  families = Object.keys(AREA_FAMILIES),
  search = searchArea,
  onProgress = async () => {},
  deadlineMs = RUN_DEADLINE_MS,
  freshDays = AREA_FRESH_DAYS,
}) {
  const parts = [];
  for (const location of locations) for (const family of families) parts.push({ location, family });
  const fresh = await freshAreaScans(campaignId, new Date(Date.now() - freshDays * 86400000).toISOString());
  const pending = parts.filter((p) => !fresh.has(p.location + "|" + p.family));
  const summary = {
    searches: 0, found: 0, created: 0, noWebsite: 0, hasWebsite: 0, errors: [], stopped: null,
    total: parts.length, attempted: parts.length - pending.length, remaining: 0,
  };
  const started = Date.now();
  let streak = 0;
  await onProgress({ ...summary });
  for (let i = 0; i < pending.length; i++) {
    const { location, family } = pending[i];
    if (Date.now() - started > deadlineMs) {
      summary.remaining = pending.length - i;
      summary.stopped = "Stopped after the " + Math.round(deadlineMs / 60000) + " minute limit. " + summary.attempted + " of " + parts.length + " area parts are done. Run it again to continue; everything found so far is saved.";
      break;
    }
    if (streak >= MAX_CONSECUTIVE_FAILURES) {
      summary.remaining = pending.length - i;
      summary.stopped = "Stopped after " + MAX_CONSECUTIVE_FAILURES + " parts in a row failed (the free map servers look busy). " + summary.attempted + " of " + parts.length + " are done. Run it again later to continue.";
      break;
    }
    summary.attempted++;
    try {
      const places = await search({ location, family });
      let created = 0;
      for (const p of places) {
        const r = await upsertPlace(brandId, p, family + " in " + location);
        if (r.created) created++;
        if (p.bucket === "no_website") summary.noWebsite++;
        else summary.hasWebsite++;
      }
      summary.searches++;
      summary.found += places.length;
      summary.created += created;
      await markAreaScan(campaignId, location, family, places.length);
      await recordSearch(brandId, { query: family + " in " + location, results: places.length, new_leads: created });
      streak = 0;
    } catch (err) {
      streak++;
      summary.errors.push(family + " in " + location + ": " + err.message);
      await recordSearch(brandId, { query: family + " in " + location, error: err.message });
    }
    await onProgress({ ...summary });
  }
  return summary;
}
