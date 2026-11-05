// Small pure helpers for drawing charts: round axis steps, compact numbers, and which labels to show.

/** A round top value and step so the axis has clean numbers (1, 2, 5 times a power of ten). */
export function niceScale(maxValue, ticks = 4) {
  const max = Number(maxValue);
  if (!(max > 0)) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { top: step * ticks, step };
}

/** Axis and label numbers: 850, 1.2k, 3.4m. */
export function compact(n) {
  const v = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (v >= 1e6) return `${sign}${trim(v / 1e6)}m`;
  if (v >= 1e3) return `${sign}${trim(v / 1e3)}k`;
  return `${sign}${Math.round(v * 10) / 10}`;
}
const trim = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, "");

/** Whole dollars from cents, compact: $850, $1.2k. */
export const compactMoney = (cents) => `$${compact(Math.round(cents / 100))}`;

/** Show about `max` labels along an axis by skipping evenly; the last one is always kept. */
export function labelEvery(count, max = 10) {
  return Math.max(1, Math.ceil(count / max));
}
