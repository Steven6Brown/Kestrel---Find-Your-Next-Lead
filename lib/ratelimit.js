// Small in-memory limiter for public endpoints. Good enough for a single-instance
// deployment; swap for a shared store (e.g. Upstash) if this runs on many instances.
const hits = new Map();

export function allow(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}
