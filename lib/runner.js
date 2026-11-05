// Executes a campaign: one run row, every (type x city) search, a summary at the end.
// Used by the "Run now" button and by the cron endpoint that Windows Task Scheduler calls.
import { runDiscovery } from "./discovery.js";
import { createRun, expireStaleRuns, finishRun, runningRun, touchCampaign, updateRunProgress } from "./store.js";

/**
 * Starts a run and returns immediately with { runId, done } where `done` resolves when the
 * scan finishes. Callers hand `done` to after() so the HTTP response does not wait on it.
 */
export async function startRun({ brandId, campaign, trigger = "manual", discover = runDiscovery }) {
  await expireStaleRuns(brandId);
  if (await runningRun(brandId, campaign.id)) return { skipped: true, reason: "This campaign is already running." };
  const runId = await createRun(brandId, { campaignId: campaign.id, campaignName: campaign.name, trigger });
  const done = (async () => {
    try {
      const s = await discover({
        brandId, locations: campaign.locations, categories: campaign.categories, maxPages: 1,
        onProgress: (p) => updateRunProgress(runId, p),
      });
      const allFailed = s.searches === 0 && s.errors.length > 0;
      await finishRun(runId, {
        status: allFailed ? "error" : s.errors.length || s.stopped ? "partial" : "done",
        searches: s.searches, found: s.found, created: s.created, noWebsite: s.noWebsite, hasWebsite: s.hasWebsite,
        error: [s.stopped, ...s.errors.slice(0, 2)].filter(Boolean).join(" | ") || null,
      });
    } catch (err) {
      await finishRun(runId, { status: "error", error: err.message });
    } finally {
      await touchCampaign(campaign.id);
    }
  })();
  return { runId, done };
}
