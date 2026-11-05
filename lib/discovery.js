// Phase 1: query Places for every (category x location) combination, dedupe on
// Google Place ID, and split into no-website and has-website buckets.
import { searchPlaces } from "./places.js";
import { searchOverpass } from "./overpass.js";
import { upsertPlace, recordSearch } from "./store.js";

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
