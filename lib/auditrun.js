// Runs the free website quality audit over every lead that has a real website, in the background.
import { auditSite } from "./audit.js";
import { skipReason } from "./chains.js";
import * as store from "./store.js";

export const AUDIT_DEADLINE_MS = 25 * 60 * 1000;

export async function auditSites({
  brandId,
  auditFn = auditSite,
  concurrency = 3,
  deadlineMs = AUDIT_DEADLINE_MS,
  limit = 400,
  onProgress = async () => {},
}) {
  const leads = await store.leadsToAudit(brandId, { limit });
  const summary = { total: leads.length, attempted: 0, scored: 0, unreachable: 0, blocked: 0, chains: 0, listings: 0, errors: [], stopped: null };
  const started = Date.now();
  await onProgress({ ...summary });
  let next = 0;
  const worker = async () => {
    while (next < leads.length) {
      if (Date.now() - started > deadlineMs) {
        summary.stopped ||= `Stopped after the ${Math.round(deadlineMs / 60000)} minute limit. Run it again to continue; finished sites are saved.`;
        return;
      }
      const lead = leads[next++];
      try {
        const skip = skipReason(lead);
        const r = skip ? { status: skip.status, score: null, checks: [], reasons: [skip.reason], psi: null } : await auditFn(lead.website);
        await store.applyAudit(brandId, lead.id, r);
        if (r.status === "chain") summary.chains++;
        else if (r.status === "listing") summary.listings++;
        else if (r.status === "ok") summary.scored++;
        else if (r.status === "unreachable") summary.unreachable++;
        else summary.blocked++; // refused, or built with scripts: could not be read
      } catch (err) {
        summary.errors.push(`${lead.name}: ${err.message}`.slice(0, 160));
      }
      summary.attempted++;
      await onProgress({ ...summary });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return summary;
}

/** Start an audit run in the background. Returns { runId, done } or { skipped, reason }. */
export async function startAudit({ brandId, audit = auditSites }) {
  await store.expireStaleRuns(brandId);
  if (await store.runningAudit(brandId)) return { skipped: true, reason: "A website quality check is already running." };
  const runId = await store.createRun(brandId, { campaignId: null, campaignName: "Website quality check", trigger: "audit" });
  const done = (async () => {
    try {
      const s = await audit({
        brandId,
        onProgress: (p) => store.updateRunProgress(runId, {
          total: p.total, attempted: p.attempted, found: p.attempted, created: 0, noWebsite: p.unreachable + p.blocked, hasWebsite: p.scored,
        }),
      });
      const failed = s.attempted === 0 && s.errors.length > 0;
      await store.finishRun(runId, {
        status: failed ? "error" : s.errors.length || s.stopped ? "partial" : "done",
        searches: s.attempted, found: s.attempted, created: 0, noWebsite: s.unreachable + s.blocked, hasWebsite: s.scored,
        error: [s.stopped, ...s.errors.slice(0, 2)].filter(Boolean).join(" | ") || null,
      });
    } catch (err) {
      await store.finishRun(runId, { status: "error", error: err.message });
    }
  })();
  return { runId, done };
}
