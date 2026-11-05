// Pure invoice rules (no database, no network), shared by the store and the invoicing service.

export const INVOICE_KINDS = [["full", "Full amount"], ["deposit", "50% deposit"], ["balance", "Remaining balance"]];

/** What a given kind of invoice would be for, or null when it is not allowed right now. */
export function amountForKind(kind, quotedCents, invoicedCents) {
  if (!Number.isInteger(quotedCents) || quotedCents <= 0) return null;
  if (kind === "full") return invoicedCents === 0 ? quotedCents : null;
  if (kind === "deposit") return invoicedCents === 0 ? Math.round(quotedCents / 2) : null;
  if (kind === "balance") return invoicedCents > 0 && invoicedCents < quotedCents ? quotedCents - invoicedCents : null;
  return null;
}

/** PayPal sends money as decimal strings like "2500.50". */
export function centsFromPayPal(value) {
  return /^\d{1,9}(\.\d{1,2})?$/.test(String(value ?? "")) ? Math.round(Number(value) * 100) : null;
}

const GROUPS = {
  draft: ["DRAFT"],
  sent: ["SENT", "UNPAID", "SCHEDULED", "PAYMENT_PENDING", "SHARED"],
  partial: ["PARTIALLY_PAID"],
  paid: ["PAID", "MARKED_AS_PAID", "PAID_EXTERNAL"],
  cancelled: ["CANCELLED", "AUTO_CANCELLED"],
  refunded: ["REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED", "REFUNDED_EXTERNAL"],
};

/** Our own handful of states from PayPal's longer list. PENDING and FAILED are local-only. */
export function statusGroup(status) {
  if (status === "PENDING") return "pending";
  if (status === "FAILED") return "failed";
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(status)) return g;
  return "unknown";
}

export const STATUS_LABELS = {
  pending: "Creating", failed: "Failed", draft: "Draft", sent: "Sent", partial: "Partly paid",
  paid: "Paid", cancelled: "Cancelled", refunded: "Refunded", unknown: "Unknown",
};

/** Groups that still need checking with PayPal. */
export const OPEN_GROUPS = ["draft", "sent", "partial"];
/** Groups that count as money you are owed. */
export const OWED_GROUPS = ["sent", "partial"];
/** Groups that count toward what has been billed on a project. */
export const BILLED_GROUPS = ["pending", "draft", "sent", "partial", "paid", "refunded", "unknown"];

export const isOverdue = (inv, today) => OWED_GROUPS.includes(statusGroup(inv.status)) && !!inv.due_on && inv.due_on < today;
