// Free website verification: for scanned businesses that look like they have no website,
// look each one up in Overture Maps and record any website that is already listed there.
import { expandBox, fetchPlaces as defaultFetchPlaces } from "./overture.js";
import { geocode as defaultGeocode } from "./overpass.js";
import { bestWebsite, locationOfLead, matchLead } from "./matchsites.js";
import * as store from "./store.js";

export const VERIFY_DEADLINE_MS = 25 * 60 * 1000;

/**
 * Check every unverified lead, one area at a time. Each area is a single dataset query, so this is
 * quick. Leads not found stay "unverified": absence from the dataset proves nothing.
 */
export async function verifyWebsites({
  brandId,
  geocodeFn = (loc) => defaultGeocode(loc),
  fetchPlacesFn = defaultFetchPlaces,
  onProgress = async () => {},
  deadlineMs = VERIFY_DEADLINE_MS,
  limit = 3000,
}) {
  const leads = await store.unverifiedLeads(brandId, { limit });
  const groups = new Map();
  for (const lead of leads) {
    const loc = locationOfLead(lead);
    if (!loc) continue;
    (groups.get(loc) || groups.set(loc, []).get(loc)).push(lead);
  }
  const summary = { areas: groups.size, attempted: 0, checked: 0, foundSite: 0, foundSocial: 0, notFound: 0, errors: [], stopped: null };
  const started = Date.now();
  await onProgress({ ...summary });
  for (const [location, group] of groups) {
    if (Date.now() - started > deadlineMs) {
      summary.stopped = `Stopped after the ${Math.round(deadlineMs / 60000)} minute limit. Run it again to continue; finished areas are saved.`;
      break;
    }
    summary.attempted++;
    try {
      const scope = await geocodeFn(location);
      if (!scope?.box) throw new Error("no map area for this place");
      const places = await fetchPlacesFn(expandBox(scope.box));
      for (const lead of group) {
        const m = matchLead(lead, places);
        const best = m ? bestWebsite(m.candidate) : null;
        const outcome = await store.applyWebsiteVerification(brandId, lead.id, best ? { ...best, source: "overture" } : null);
        summary.checked++;
        if (outcome === "site") summary.foundSite++;
        else if (outcome === "social") summary.foundSocial++;
        else summary.notFound++;
      }
    } catch (err) {
      summary.errors.push(`${location}: ${err.message}`.slice(0, 200));
    }
    await onProgress({ ...summary });
  }
  return summary;
}

/** Start a verification run in the background. Returns { runId, done } or { skipped, reason }. */
export async function startVerification({ brandId, verify = verifyWebsites }) {
  await store.expireStaleRuns(brandId);
  if (await store.runningVerification(brandId)) return { skipped: true, reason: "A website check is already running." };
  const runId = await store.createRun(brandId, { campaignId: null, campaignName: "Website verification", trigger: "verify" });
  const done = (async () => {
    try {
      const s = await verify({
        brandId,
        onProgress: (p) => store.updateRunProgress(runId, {
          total: p.areas, attempted: p.attempted, found: p.checked, created: 0, noWebsite: p.notFound, hasWebsite: p.foundSite,
        }),
      });
      const failed = s.attempted > 0 && s.errors.length === s.attempted;
      await store.finishRun(runId, {
        status: failed ? "error" : s.errors.length || s.stopped ? "partial" : "done",
        searches: s.attempted, found: s.checked, created: 0, noWebsite: s.notFound, hasWebsite: s.foundSite,
        error: [s.stopped, ...s.errors.slice(0, 2)].filter(Boolean).join(" | ") || null,
      });
    } catch (err) {
      await store.finishRun(runId, { status: "error", error: err.message });
    }
  })();
  return { runId, done };
}
