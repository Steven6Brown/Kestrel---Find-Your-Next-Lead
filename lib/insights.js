// Business statistics for the Insights page. Everything here is pure: rows in, numbers out, so each figure can
// be tested without a database or a screen. Only what Kestrel actually recorded is counted:
//   - replies, meetings, and wins count when a stage was changed (Kestrel cannot see your inbox)
//   - money counts invoices made through Kestrel and PayPal, in US dollars
// Every rate carries the counts behind it, and a rate over fewer than MIN_SAMPLE items is not shown as a percentage.
import { statusGroup, OWED_GROUPS } from "./invoicestatus.js";

const DAY = 86400000;

export const RANGES = [["30", "Last 30 days", 30], ["90", "Last 90 days", 90], ["365", "Last 12 months", 365], ["all", "All time", null]];
export const DEFAULT_RANGE = "90";
export const MIN_SAMPLE = 20;

export const parseRange = (v) => (RANGES.some(([k]) => k === v) ? v : DEFAULT_RANGE);

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** First moment of the period (local midnight), or null for all time. */
export function rangeStart(range, now = new Date()) {
  const days = RANGES.find(([k]) => k === range)?.[2];
  if (days == null) return null;
  const s = startOfDay(now);
  s.setDate(s.getDate() - (days - 1));
  return s;
}

const ts = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const within = (iso, startMs, endMs) => {
  const t = ts(iso);
  return t !== null && (startMs == null || t >= startMs) && t <= endMs;
};

/** A share, kept with the counts it came from. Fewer than MIN_SAMPLE in the denominator is flagged "small". */
export function rate(num, den) {
  if (!(den > 0)) return { num, den: 0, pct: null, small: true };
  return { num, den, pct: Math.round((num / den) * 100), small: den < MIN_SAMPLE };
}

/** Plain words for a rate, never a bare percentage. */
export function rateText(r) {
  if (!r || !r.den) return "No data yet";
  if (r.small) return `${r.num} of ${r.den}, too few to judge`;
  return `${r.pct}% (${r.num} of ${r.den})`;
}

const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- time buckets ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Weekly buckets for periods up to about three months, monthly for longer. Every bucket is present, zeros included. */
export function makeBuckets(start, now, earliestMs = null) {
  let from = start ? new Date(start) : earliestMs != null ? new Date(earliestMs) : new Date(now);
  from = startOfDay(from);
  const span = Math.round((startOfDay(now) - from) / DAY);
  const unit = span > 100 ? "month" : "week";
  const out = [];
  if (unit === "week") {
    const cursor = new Date(from);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // back to Monday
    while (cursor <= now) {
      const s = new Date(cursor);
      const e = new Date(cursor);
      e.setDate(e.getDate() + 7);
      out.push({ start: s, end: e, label: `${MONTHS[s.getMonth()]} ${s.getDate()}` });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= now) {
      const s = new Date(cursor);
      const e = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      out.push({ start: s, end: e, label: s.getMonth() === 0 || !out.length ? `${MONTHS[s.getMonth()]} '${String(s.getFullYear()).slice(2)}` : MONTHS[s.getMonth()] });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return { unit, buckets: out.slice(-24) };
}

/** Sum a value per bucket. `items` are filtered by the caller; anything outside every bucket is ignored. */
export function sumByBucket(buckets, items, getIso, getValue = () => 1) {
  const sums = buckets.map(() => 0);
  for (const it of items) {
    const t = ts(getIso(it));
    if (t === null) continue;
    const i = buckets.findIndex((b) => t >= b.start.getTime() && t < b.end.getTime());
    if (i >= 0) sums[i] += getValue(it);
  }
  return sums;
}

// ---------- how far each contact got ----------

export const FUNNEL = [
  ["found", "Found"],
  ["drafted", "Draft written"],
  ["sent", "Contacted"],
  ["replied", "Replied"],
  ["meeting", "Meeting booked"],
  ["proposal", "Proposal sent"],
  ["won", "Won"],
];
const RANK = { found: 0, drafted: 1, sent: 2, replied: 3, meeting: 4, proposal: 5, won: 6 };
const STAGE_RANK = { contacted: RANK.sent, replied: RANK.replied, meeting_booked: RANK.meeting, proposal_sent: RANK.proposal, won: RANK.won };

/** Index of the furthest step each lead reached, from drafts, sent emails, the stage log and the current stage. */
export function leadRanks(rows) {
  const draftBy = new Map((rows.drafts || []).map((d) => [d.lead_id, d]));
  const emailBy = new Map((rows.emails || []).map((e) => [e.lead_id, e]));
  const eventsBy = new Map();
  for (const e of rows.events || []) (eventsBy.get(e.lead_id) || eventsBy.set(e.lead_id, []).get(e.lead_id)).push(e);
  const ranks = new Map();
  for (const l of rows.leads || []) {
    let r = RANK.found;
    const d = draftBy.get(l.id);
    if (d) r = Math.max(r, RANK.drafted);
    if (d?.status === "sent" || emailBy.has(l.id)) r = Math.max(r, RANK.sent);
    r = Math.max(r, STAGE_RANK[l.stage] ?? 0);
    for (const e of eventsBy.get(l.id) || []) r = Math.max(r, STAGE_RANK[e.to] ?? 0);
    ranks.set(l.id, r);
  }
  return ranks;
}

/** Contacts first seen in the period, and how many reached each step (at least that far). */
export function computeFunnel(rows, startMs, endMs) {
  const ranks = leadRanks(rows);
  const cohort = (rows.leads || []).filter((l) => within(l.first_seen_at, startMs, endMs));
  const steps = FUNNEL.map(([key, label], i) => ({ key, label, count: cohort.filter((l) => ranks.get(l.id) >= i).length }));
  return steps.map((s, i) => ({
    ...s,
    ofPrev: i === 0 ? null : rate(s.count, steps[i - 1].count),
    ofFound: i === 0 ? null : rate(s.count, steps[0].count),
  }));
}

// ---------- outreach ----------

export const DRAFT_KINDS = [["no_website", "No website email"], ["redesign", "Redesign email"]];

/** Emails sent in the period, per week or month, and how each kind of email did. */
export function computeOutreach(rows, startMs, endMs, now) {
  const ranks = leadRanks(rows);
  const sent = (rows.drafts || []).filter((d) => d.status === "sent" && within(d.sent_at, startMs, endMs));
  const earliest = sent.length ? Math.min(...sent.map((d) => ts(d.sent_at))) : null;
  const { unit, buckets } = makeBuckets(startMs == null ? null : new Date(startMs), now, earliest);
  const perBucket = sumByBucket(buckets, sent, (d) => d.sent_at);
  const byKind = DRAFT_KINDS.map(([key, label]) => {
    const mine = sent.filter((d) => (d.kind || "no_website") === key);
    const at = (rank) => mine.filter((d) => (ranks.get(d.lead_id) ?? 0) >= rank).length;
    return {
      key, label, sent: mine.length,
      replied: rate(at(RANK.replied), mine.length),
      meetings: rate(at(RANK.meeting), mine.length),
      won: rate(at(RANK.won), mine.length),
    };
  });
  return { unit, buckets: buckets.map((b, i) => ({ label: b.label, values: [perBucket[i]] })), totalSent: sent.length, byKind };
}

// ---------- where wins come from ----------

/** Group contacts first seen in the period by business type, city or source. */
export function computeWhere(rows, startMs, endMs, keyOf, limit = 8) {
  const ranks = leadRanks(rows);
  const groups = new Map();
  for (const l of (rows.leads || []).filter((x) => within(x.first_seen_at, startMs, endMs))) {
    const key = keyOf(l);
    if (!key) continue;
    const g = groups.get(key) || { key, leads: 0, contacted: 0, replied: 0, won: 0 };
    const r = ranks.get(l.id);
    g.leads++;
    if (r >= RANK.sent) g.contacted++;
    if (r >= RANK.replied) g.replied++;
    if (r >= RANK.won) g.won++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.contacted - a.contacted || b.leads - a.leads || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((g) => ({ ...g, winRate: rate(g.won, g.contacted) }));
}

// ---------- speed ----------

/** Days from first contact to won, for contacts won in the period. */
export function computeSpeed(rows, startMs, endMs, todayStr) {
  const wonEvents = new Map();
  const firstEvent = new Map();
  for (const e of rows.events || []) {
    const t = ts(e.created_at);
    if (t === null) continue;
    if (e.to === "won" && (!wonEvents.has(e.lead_id) || t < wonEvents.get(e.lead_id))) wonEvents.set(e.lead_id, t);
    if ((STAGE_RANK[e.to] ?? 0) >= RANK.sent && (!firstEvent.has(e.lead_id) || t < firstEvent.get(e.lead_id))) firstEvent.set(e.lead_id, t);
  }
  const emailAt = new Map((rows.emails || []).map((e) => [e.lead_id, ts(e.first_at)]));
  const sentAt = new Map((rows.drafts || []).filter((d) => d.status === "sent").map((d) => [d.lead_id, ts(d.sent_at)]));
  const days = [];
  for (const [leadId, wonAt] of wonEvents) {
    if (!within(new Date(wonAt).toISOString(), startMs, endMs)) continue;
    const first = Math.min(...[firstEvent.get(leadId), emailAt.get(leadId), sentAt.get(leadId)].filter((v) => v != null));
    if (Number.isFinite(first) && wonAt >= first) days.push((wonAt - first) / DAY);
  }
  const overdue = (rows.tasks || []).filter((t) => t.due_on && t.due_on < todayStr).length;
  const done = (rows.meetings || []).filter((m) => m.status === "done" && within(m.starts_at, startMs, endMs)).length;
  return { medianDays: median(days) === null ? null : Math.round(median(days) * 10) / 10, wonCount: days.length, overdueFollowups: overdue, meetingsHeld: done };
}

// ---------- money ----------

/** Invoices and projects, in US dollars. Other currencies are counted and left out, never mixed in. */
export function computeMoney(rows, startMs, endMs, now, todayStr) {
  const usd = (r) => (r.currency || "USD") === "USD";
  const invoices = (rows.invoices || []).filter(usd);
  const skipped = (rows.invoices || []).length - invoices.length + (rows.projects || []).filter((p) => !usd(p)).length;
  const billed = invoices.filter((i) => i.sent_at && !["cancelled", "failed", "pending", "draft"].includes(statusGroup(i.status)) && within(i.sent_at, startMs, endMs));
  const paid = invoices.filter((i) => statusGroup(i.status) === "paid" && i.paid_at && within(i.paid_at, startMs, endMs));
  const earliest = [...billed.map((i) => ts(i.sent_at)), ...paid.map((i) => ts(i.paid_at))].filter((v) => v != null);
  const { unit, buckets } = makeBuckets(startMs == null ? null : new Date(startMs), now, earliest.length ? Math.min(...earliest) : null);
  const billedBy = sumByBucket(buckets, billed, (i) => i.sent_at, (i) => i.amount_cents);
  const paidBy = sumByBucket(buckets, paid, (i) => i.paid_at, (i) => i.amount_cents);
  const sum = (list) => list.reduce((a, i) => a + i.amount_cents, 0);
  const byType = new Map();
  for (const i of paid) byType.set(i.project_type || "other", (byType.get(i.project_type || "other") || 0) + i.amount_cents);
  const quotes = (rows.projects || []).filter((p) => usd(p) && p.status !== "cancelled" && p.quoted_amount_cents > 0 && within(p.created_at, startMs, endMs));
  const proposals = (rows.projects || []).filter((p) => usd(p) && p.status === "proposed" && p.quoted_amount_cents > 0);
  const owed = invoices.filter((i) => OWED_GROUPS.includes(statusGroup(i.status)));
  const owedCents = (i) => i.due_cents ?? i.amount_cents;
  const late = owed.filter((i) => i.due_on && i.due_on < todayStr);
  return {
    unit,
    buckets: buckets.map((b, i) => ({ label: b.label, values: [billedBy[i], paidBy[i]] })),
    billedCents: sum(billed),
    paidCents: sum(paid),
    revenueByType: [...byType.entries()].map(([type, cents]) => ({ type, cents })).sort((a, b) => b.cents - a.cents),
    avgProjectCents: quotes.length ? Math.round(quotes.reduce((a, p) => a + p.quoted_amount_cents, 0) / quotes.length) : null,
    projectCount: quotes.length,
    openProposalCents: proposals.reduce((a, p) => a + p.quoted_amount_cents, 0),
    openProposalCount: proposals.length,
    outstandingCents: owed.reduce((a, i) => a + owedCents(i), 0),
    outstandingCount: owed.length,
    overdueCents: late.reduce((a, i) => a + owedCents(i), 0),
    overdueCount: late.length,
    skippedOtherCurrency: skipped,
  };
}

/** Everything the page shows, for one period. `money` is null when the viewer may not see money. */
export function computeInsights(rows, { range = DEFAULT_RANGE, now = new Date(), includeMoney = false, todayStr }) {
  const start = rangeStart(range, now);
  const startMs = start ? start.getTime() : null;
  const endMs = now.getTime();
  const funnel = computeFunnel(rows, startMs, endMs);
  const outreach = computeOutreach(rows, startMs, endMs, now);
  const speed = computeSpeed(rows, startMs, endMs, todayStr);
  const by = (fn) => computeWhere(rows, startMs, endMs, fn);
  return {
    range, funnel, outreach, speed,
    where: {
      category: by((l) => l.category_label || ""),
      city: by((l) => l.city || ""),
      source: computeWhere(rows, startMs, endMs, (l) => l.source || "", 10),
    },
    money: includeMoney ? computeMoney(rows, startMs, endMs, now, todayStr) : null,
  };
}
