// CRM rules that do not touch the database: stages, labels, and date helpers.
// Dates for tasks are plain calendar days ("YYYY-MM-DD", in the server's local time), because a
// follow-up is due "on a day", not at an instant. Timeline entries use ISO timestamps.

export const STAGES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["meeting_booked", "Meeting booked"],
  ["proposal_sent", "Proposal sent"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["not_interested", "Not interested"],
];
export const STAGE_KEYS = STAGES.map(([k]) => k);
export const stageLabel = (k) => STAGES.find(([s]) => s === k)?.[1] || k;

/** Stages that mean the conversation is over; open tasks are not auto-closed, but pipeline counts split them out. */
export const CLOSED_STAGES = ["won", "lost", "not_interested"];

export const SOURCES = [
  ["kestrel", "Kestrel scan"],
  ["inbound", "Website inquiry"],
  ["referral", "Referral"],
  ["manual", "Added by hand"],
  ["seminar", "Seminar contact"],
];
export const sourceLabel = (k) => SOURCES.find(([s]) => s === k)?.[1] || k;
export const MANUAL_SOURCES = SOURCES.filter(([k]) => k !== "kestrel" && k !== "inbound");

export const ACTIVITY_KINDS = ["note", "call", "email_in", "email_out", "meeting", "stage_change", "payment", "system"];
export const LOGGABLE_KINDS = [
  ["note", "Note"],
  ["call", "Call"],
  ["email_in", "Reply received"],
  ["email_out", "Email sent"],
  ["meeting", "Meeting"],
];
export const KIND_LABELS = {
  note: "Note", call: "Call", email_in: "Reply received", email_out: "Email sent",
  meeting: "Meeting", stage_change: "Stage changed", payment: "Payment", system: "System",
};

const pad = (n) => String(n).padStart(2, "0");

/** Today's calendar day in local time as YYYY-MM-DD. */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(y, m - 1, d + days);
  return todayStr(t);
}

export const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));

export const QUICK_DUE = [
  ["Tomorrow", 1],
  ["In 3 days", 3],
  ["Next week", 7],
  ["In 2 weeks", 14],
  ["In a month", 30],
];

/** A friendly label for a due day relative to today. */
export function dueLabel(dueOn, today = todayStr()) {
  if (!dueOn) return "No date";
  if (dueOn < today) return `Overdue since ${dueOn}`;
  if (dueOn === today) return "Due today";
  if (dueOn === addDays(today, 1)) return "Due tomorrow";
  return `Due ${dueOn}`;
}

/** What a stage change implies for the older `status` field that scanning and sending still use. */
export function statusForStage(stage, currentStatus) {
  if (stage === "not_interested") return "do_not_contact";
  if (["contacted", "replied", "meeting_booked", "proposal_sent", "won", "lost"].includes(stage)) {
    return currentStatus === "new" ? "contacted" : currentStatus;
  }
  return currentStatus;
}

// ---------- clients, projects, meetings ----------

export const CLIENT_STATUSES = [["active", "Active"], ["paused", "Paused"], ["ended", "Ended"]];
export const PROJECT_TYPES = [["website", "Website"], ["app", "App"], ["it_support", "IT support"], ["other", "Other"]];
export const PROJECT_STATUSES = [
  ["proposed", "Proposed"], ["in_progress", "In progress"], ["delivered", "Delivered"], ["maintenance", "Maintenance"], ["cancelled", "Cancelled"],
];
export const MEETING_LOCATIONS = [["meet", "Google Meet"], ["phone", "Phone"], ["in_person", "In person"], ["other", "Other"]];
export const MEETING_TITLES = ["Intro call", "Discovery call", "Proposal review", "Check-in", "Project kickoff", "Handoff"];
/** ISO bounds from now to N days ahead, for "coming up" lists. */
export function nextDaysWindow(days, now = Date.now()) {
  return { fromIso: new Date(now).toISOString(), toIso: new Date(now + days * 86400000).toISOString() };
}
export const MEETING_STATUSES = ["scheduled", "done", "cancelled"];

export const labelOf = (list, key) => list.find(([k]) => k === key)?.[1] || key;

/** "1500", "1,500.50" or "$99" to integer cents; null when it is not a plain amount. */
export function parseMoneyToCents(input) {
  const s = String(input ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function formatCents(cents, currency = "USD") {
  if (cents == null) return "Not quoted";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/**
 * A "datetime-local" form value (YYYY-MM-DDTHH:MM) is read in the server's local time zone, which
 * for a locally run app is yours, and stored as UTC. Returns null for anything else.
 */
export function localInputToIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const meetingWhen = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
