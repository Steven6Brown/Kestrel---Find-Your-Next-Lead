// Calendar rules with no database or network. All days are plain local calendar days
// ("YYYY-MM-DD") in this computer's time zone, matching how tasks and meetings are entered.
import { MEETING_LOCATIONS, addDays, formatCents, labelOf, todayStr } from "./crm.js";
import { timeLabel } from "./campaigns.js";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11" to { year, month } (month 1 to 12), or null for anything else. */
export function parseMonth(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}

export const monthKey = ({ year, month }) => `${year}-${String(month).padStart(2, "0")}`;
export const monthTitle = ({ year, month }) => `${MONTH_NAMES[month - 1]} ${year}`;

export function shiftMonth({ year, month }, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const monthOf = (dateStr) => ({ year: Number(dateStr.slice(0, 4)), month: Number(dateStr.slice(5, 7)) });

/** Weeks (Sunday first) covering the month, each day { date, inMonth }. */
export function monthGrid({ year, month }) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const start = addDays(todayStr(first), -first.getDay());
  const end = addDays(todayStr(last), 6 - last.getDay());
  const weeks = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      return { date, inMonth: monthOf(date).month === month && monthOf(date).year === year };
    }));
  }
  return weeks;
}

/** ISO instants for the start of a local day and the start of the day after another. */
export function dayStartIso(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
}
export const dayAfterIso = (dateStr) => dayStartIso(addDays(dateStr, 1));

/** The local calendar day an ISO instant falls on. */
export const localDay = (iso) => todayStr(new Date(iso));

export const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Days (inclusive) on which a schedule runs. Mirrors the Windows Task Scheduler options. */
export function scheduledDays(frequency, fromDay, toDay) {
  if (!["daily", "weekdays", "weekly"].includes(frequency)) return [];
  const out = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    if (frequency === "daily" || (frequency === "weekdays" && dow >= 1 && dow <= 5) || (frequency === "weekly" && dow === 1)) out.push(d);
  }
  return out;
}

/** Group items into { "YYYY-MM-DD": [...] } using a function that names each item's day. */
export function groupByDay(items, dayOf) {
  const map = {};
  for (const item of items) (map[dayOf(item)] ||= []).push(item);
  return map;
}

export const TYPE_LABELS = { meeting: "Meeting", task: "Follow-up", invoice: "Invoice due", scan: "Scan" };
const ORDER = { meeting: 1, task: 2, invoice: 3, scan: 4 };

/**
 * Raw rows in, { "YYYY-MM-DD": [item, ...] } out. Each item: { type, title, detail, href, sort }.
 * Meetings come first (by time), then follow-ups, invoices due, and scheduled scans.
 */
export function assembleCalendar({ meetings = [], tasks = [], invoices = [], campaigns = [] }, fromDay, toDay) {
  const items = [];
  for (const m of meetings) {
    if (m.status === "cancelled") continue;
    const who = m.lead_name || m.client_name || "";
    items.push({
      type: "meeting", day: localDay(m.starts_at), sort: m.starts_at,
      title: `${clockTime(m.starts_at)} ${m.title}`,
      detail: [who, labelOf(MEETING_LOCATIONS, m.location), m.status === "done" ? "done" : ""].filter(Boolean).join(" · "),
      href: m.lead_id ? `/leads/${m.lead_id}` : `/clients/${m.client_id}`,
    });
  }
  for (const t of tasks) {
    items.push({ type: "task", day: t.due_on, sort: "", title: t.title, detail: t.lead_name || "", href: `/leads/${t.lead_id}` });
  }
  for (const i of invoices) {
    items.push({
      type: "invoice", day: i.due_on, sort: "",
      title: `${formatCents(i.due_cents ?? i.amount_cents, i.currency)} from ${i.client_name}`,
      detail: i.invoice_number ? `Invoice ${i.invoice_number}` : "Invoice", href: "/invoices",
    });
  }
  for (const camp of campaigns) {
    if (!camp.enabled) continue;
    for (const day of scheduledDays(camp.frequency, fromDay, toDay)) {
      items.push({ type: "scan", day, sort: camp.run_time, title: camp.name, detail: timeLabel(camp.run_time), href: `/campaigns/${camp.id}` });
    }
  }
  const byDay = groupByDay(items.filter((x) => x.day >= fromDay && x.day <= toDay), (x) => x.day);
  for (const list of Object.values(byDay)) list.sort((a, b) => ORDER[a.type] - ORDER[b.type] || String(a.sort).localeCompare(String(b.sort)));
  return byDay;
}
