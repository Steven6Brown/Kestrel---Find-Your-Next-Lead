// Score cutoffs for the Redesign targets list, and helpers for leads that already have a website.
// The cutoff is picked from buttons; anything else in the URL falls back to the default.
export const THRESHOLDS = [50, 60, 70, 80];
export const DEFAULT_THRESHOLD = 60;

export function parseThreshold(v) {
  const n = /^[0-9]{1,3}$/.test(String(v ?? "")) ? Number(v) : NaN;
  return THRESHOLDS.includes(n) ? n : DEFAULT_THRESHOLD;
}

/** A lead whose own website was read and scored, so a redesign concept and email can be made. */
export function isRedesignLead(lead) {
  return !!lead && lead.bucket === "has_website" && lead.audit_status === "ok" && lead.audit_score != null && lead.status !== "do_not_contact" && !lead.closed_at;
}

/** What the quality check found for a lead: { score, reasons, checkedAt, website } or null. */
export function auditOf(lead) {
  if (!isRedesignLead(lead)) return null;
  let detail = {};
  try {
    detail = JSON.parse(lead.audit_json || "{}");
  } catch {
    detail = {};
  }
  return {
    score: Number(lead.audit_score),
    reasons: Array.isArray(detail.reasons) ? detail.reasons.filter((r) => typeof r === "string").slice(0, 6) : [],
    checkedAt: lead.audited_at || null,
    website: lead.website || "",
  };
}

/** "November 5, 2026" from an ISO timestamp (UTC, so the day never shifts with the reader's time zone). */
export function longDate(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
