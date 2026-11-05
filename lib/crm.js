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
