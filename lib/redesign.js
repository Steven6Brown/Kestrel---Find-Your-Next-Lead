// Score cutoffs for the Redesign targets list. The cutoff is picked from buttons; anything else
// in the URL falls back to the default.
export const THRESHOLDS = [50, 60, 70, 80];
export const DEFAULT_THRESHOLD = 60;

export function parseThreshold(v) {
  const n = /^[0-9]{1,3}$/.test(String(v ?? "")) ? Number(v) : NaN;
  return THRESHOLDS.includes(n) ? n : DEFAULT_THRESHOLD;
}
