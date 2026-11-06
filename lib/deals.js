// Deals (sales opportunities): the money side of a contact. Pure rules and forecast maths, no database.
//
// A deal has an amount, a stage, a chance of closing (probability, which starts from the stage but can be changed),
// and an expected close date. The forecast is the amount times the probability, so a $10,000 deal at 50% counts as $5,000.
// Winning a deal turns the contact into a client with a project; losing one needs a reason.
import { isDateStr, parseMoneyToCents, PROJECT_TYPES } from "./crm.js";
import { rate } from "./insights.js";

export const DEAL_STAGES = [["discovery", "Discovery", 20], ["proposal", "Proposal", 50], ["negotiation", "Negotiation", 75]];
export const OPEN_DEAL_STAGES = DEAL_STAGES.map(([k]) => k);
export const LOST_REASONS = [
  ["price", "Price"], ["no_response", "Stopped replying"], ["competitor", "Chose someone else"],
  ["timing", "Bad timing"], ["not_a_fit", "Not a fit"], ["other", "Other"],
];
export const MAX_DEAL_CENTS = 2_000_000_000; // the database column is a 32 bit integer: $20 million

export const dealStageLabel = (k) => ({ ...Object.fromEntries(DEAL_STAGES.map(([s, l]) => [s, l])), won: "Won", lost: "Lost" })[k] || k;
export const lostReasonLabel = (k) => LOST_REASONS.find(([r]) => r === k)?.[1] || "";
export const isOpenStage = (s) => OPEN_DEAL_STAGES.includes(s);
export const defaultProbability = (stage) => DEAL_STAGES.find(([k]) => k === stage)?.[2] ?? 20;

/** The next open stage after this one, or null at the last. */
export const nextDealStage = (stage) => OPEN_DEAL_STAGES[OPEN_DEAL_STAGES.indexOf(stage) + 1] || null;

/** Forecast value of one deal in cents: amount times probability. A deal without an amount counts as zero. */
export const weightedCents = (d) => Math.round(((d.amount_cents || 0) * (Number.isFinite(d.probability) ? d.probability : 0)) / 100);

/**
 * Check what a form sent. Returns { ok: true, value } or { ok: false, errors: [..] }. Nothing is trusted:
 * the stage, type and numbers are all checked here, and the database checks them again.
 */
export function validateDealInput(input, { stage = "discovery" } = {}) {
  const errors = [];
  const title = String(input.title ?? "").trim();
  if (!title) errors.push("Give the deal a name.");
  if (title.length > 120) errors.push("The name is too long (120 characters at most).");
  let amountCents = null;
  const rawAmount = String(input.amount ?? "").trim();
  if (rawAmount) {
    amountCents = parseMoneyToCents(rawAmount);
    if (amountCents === null) errors.push("Enter the amount as a plain number, like 2500 or 2,500.50.");
    else if (amountCents > MAX_DEAL_CENTS) errors.push("That amount is too large (the limit is $20,000,000).");
  }
  let probability = defaultProbability(stage);
  const rawProb = String(input.probability ?? "").trim();
  if (rawProb) {
    if (!/^[0-9]{1,3}$/.test(rawProb) || Number(rawProb) > 100) errors.push("Chance to win must be a whole number from 0 to 100.");
    else probability = Number(rawProb);
  }
  const rawDate = String(input.expectedCloseOn ?? "").trim();
  if (rawDate && !isDateStr(rawDate)) errors.push("Enter the expected close date as a real date.");
  const type = PROJECT_TYPES.some(([k]) => k === input.type) ? input.type : "website";
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, amountCents, probability, expectedCloseOn: rawDate || null, type } };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (dateStr) => String(dateStr).slice(0, 7);
const monthLabel = (key, first) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${first || key.endsWith("-01") ? ` '${key.slice(2, 4)}` : ""}`;
const addMonths = (key, n) => {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((((m % 12) + 12) % 12) + 1).padStart(2, "0")}`;
};

/**
 * The numbers for the Deals page. `deals` are rows from the database; `today` is YYYY-MM-DD.
 * Money that has no expected date cannot be placed on the timeline, so it is counted and reported, not guessed at.
 */
export function computeForecast(deals, { today, months = 6, closedWithinDays = 90 }) {
  const open = deals.filter((d) => isOpenStage(d.stage));
  const overdue = open.filter((d) => d.expected_close_on && d.expected_close_on < today);
  const sum = (list, f) => list.reduce((a, d) => a + f(d), 0);
  const thisMonth = monthKey(today);
  const last = addMonths(thisMonth, months - 1);
  const keys = Array.from({ length: months }, (_, i) => addMonths(thisMonth, i));
  const buckets = [];
  const place = (label, list) => buckets.push({ label, values: [sum(list, (d) => d.amount_cents || 0), sum(list, weightedCents)] });
  if (overdue.length) place("Overdue", overdue);
  keys.forEach((k, i) => place(monthLabel(k, i === 0), open.filter((d) => d.expected_close_on && d.expected_close_on >= today && monthKey(d.expected_close_on) === k)));
  const later = open.filter((d) => d.expected_close_on && monthKey(d.expected_close_on) > last);
  if (later.length) place("Later", later);

  const cutoff = (() => {
    const [y, m, d] = today.split("-").map(Number);
    const t = new Date(y, m - 1, d - closedWithinDays);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();
  const recent = (list) => list.filter((d) => d.closed_at && d.closed_at.slice(0, 10) >= cutoff);
  const won = recent(deals.filter((d) => d.stage === "won"));
  const lost = recent(deals.filter((d) => d.stage === "lost"));
  const daysToClose = won.map((d) => (Date.parse(d.closed_at) - Date.parse(d.created_at)) / 86400000).filter((n) => Number.isFinite(n) && n >= 0);
  return {
    open: {
      count: open.length,
      cents: sum(open, (d) => d.amount_cents || 0),
      weightedCents: sum(open, weightedCents),
      overdueCount: overdue.length,
      noDateCount: open.filter((d) => !d.expected_close_on).length,
      noAmountCount: open.filter((d) => !d.amount_cents).length,
    },
    buckets,
    won: { count: won.length, cents: sum(won, (d) => d.amount_cents || 0) },
    lost: { count: lost.length },
    winRate: rate(won.length, won.length + lost.length),
    avgWonCents: won.length ? Math.round(sum(won, (d) => d.amount_cents || 0) / won.length) : null,
    avgDaysToClose: daysToClose.length ? Math.round((daysToClose.reduce((a, n) => a + n, 0) / daysToClose.length) * 10) / 10 : null,
    lostReasons: LOST_REASONS.map(([k, label]) => ({ key: k, label, count: lost.filter((d) => d.lost_reason === k).length })).filter((r) => r.count > 0),
  };
}
