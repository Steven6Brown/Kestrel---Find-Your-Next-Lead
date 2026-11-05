// Phase 1: query Places for every (category x location) combination, dedupe on
// Google Place ID, and split into no-website and has-website buckets.
import { searchPlaces } from "./places.js";
import { upsertPlace, recordSearch } from "./store.js";

export const MAX_COMBOS_PER_RUN = 20; // cost guard: each combo is at least one billed request

export async function runDiscovery({
  brandId,
  locations,
  categories,
  maxPages = 1,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  search = searchPlaces,
}) {
  const combos = [];
  for (const category of categories) for (const location of locations) combos.push({ category, location });
  if (combos.length > MAX_COMBOS_PER_RUN) {
    throw new Error(
      `That is ${combos.length} searches. The limit is ${MAX_COMBOS_PER_RUN} per run to protect your Google bill. Split it up.`,
    );
  }
  const summary = { searches: 0, found: 0, created: 0, noWebsite: 0, hasWebsite: 0, errors: [] };
  for (const { category, location } of combos) {
    const query = `${category} in ${location}`;
    try {
      const places = await search({ apiKey, textQuery: query, maxPages });
      let created = 0;
      for (const p of places) {
        const r = upsertPlace(brandId, p, query);
        if (r.created) created++;
        if (p.bucket === "no_website") summary.noWebsite++;
        else summary.hasWebsite++;
      }
      summary.searches++;
      summary.found += places.length;
      summary.created += created;
      recordSearch(brandId, { query, results: places.length, new_leads: created });
    } catch (err) {
      summary.errors.push(`${query}: ${err.message}`);
      recordSearch(brandId, { query, error: err.message });
    }
  }
  return summary;
}
