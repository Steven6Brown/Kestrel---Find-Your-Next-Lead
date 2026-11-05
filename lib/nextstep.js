// What needs doing next, across the whole flow: people waiting on you, drafts to review, businesses to check.
// `pickSteps` is pure (counts in, list out) so the ordering rules can be tested without a database.
import * as store from "./store.js";
import { addDays } from "./crm.js";

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Everything that has work waiting, most urgent first. People waiting on you come before anything you
 * can do at your own pace, and finding new businesses is only suggested when nothing else is waiting.
 */
export function pickSteps(c) {
  const steps = [];
  if (c.dueNow > 0) steps.push({ key: "followups", icon: "alert", href: "/today", cta: "Open Today", count: c.dueNow, text: `${plural(c.dueNow, "follow-up is", "follow-ups are")} due now` });
  if (c.review > 0) steps.push({ key: "review", icon: "mail", href: "/queue", cta: "Review drafts", count: c.review, text: `${plural(c.review, "draft is", "drafts are")} waiting for your review` });
  if (c.approved > 0) steps.push({ key: "send", icon: "mail", href: "/queue", cta: "Send drafts", count: c.approved, text: `${plural(c.approved, "approved draft is", "approved drafts are")} ready to send` });
  if (c.lookups > 0) steps.push({ key: "lookup", icon: "list", href: "/leads", cta: "Check websites", count: c.lookups, text: `${plural(c.lookups, "business needs", "businesses need")} a website check` });
  if (c.unscored > 0) steps.push({ key: "score", icon: "list", href: "/redesign", cta: "Check quality", count: c.unscored, text: `${plural(c.unscored, "website is", "websites are")} waiting to be scored` });
  return steps;
}

/** The single best next step for a page. A step that points at the page you are already on is skipped. */
export function pickNext(c, here = "") {
  const steps = pickSteps(c).filter((s) => s.href !== here);
  if (steps.length) return steps[0];
  return { key: "scan", icon: "target", href: "/", cta: "Scan areas", count: 0, text: "Nothing is waiting. Scan a new area to find more businesses" };
}

/** The counts the rules above need. */
export async function nextStepCounts(brandId, today) {
  const [tasks, s, lookups, unscored] = await Promise.all([
    store.dueTasks(brandId, today, 0, addDays),
    store.stats(brandId),
    store.countWaitingForLookup(brandId),
    store.countUnaudited(brandId),
  ]);
  return { dueNow: tasks.overdue.length + tasks.today.length, review: s.awaitingReview, approved: s.approved, lookups, unscored };
}
