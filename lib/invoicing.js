// Invoicing rules and the service that ties PayPal to our own records.
// Amounts are always computed here from the project's quoted amount (never taken from the
// browser), and PayPal replies are only ever applied through reconcile.
import crypto from "node:crypto";
import * as store from "./store.js";
import { isValidEmail } from "./email.js";
import { safePayPalUrl } from "./paypal.js";
import { formatCents } from "./crm.js";
/** Errors whose message is written for the owner and safe to show. */
export class InvoiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvoiceError";
  }
}

import { OPEN_GROUPS, amountForKind, centsFromPayPal, statusGroup } from "./invoicestatus.js";

export { INVOICE_KINDS, STATUS_LABELS, OPEN_GROUPS, amountForKind, centsFromPayPal, isOverdue, statusGroup } from "./invoicestatus.js";

// ---------------------------------------------------------------------------------------------
// Service functions. `paypal` is a client from paypalClient() (or a stand-in in tests).

async function reconcileOne(brandId, row, paypal) {
  let inv;
  try {
    inv = await paypal.getInvoice(row.paypal_invoice_id);
  } catch (err) {
    await store.markInvoiceError(brandId, row.id, `Payment status unavailable: ${err.message}`);
    return { ok: false, error: err.message };
  }
  const dueCents = centsFromPayPal(inv.due_amount?.value);
  const paidCents = centsFromPayPal(inv.payments?.paid_amount?.value);
  const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(inv.detail?.payment_term?.due_date || "") ? inv.detail.payment_term.due_date : null;
  const result = await store.applyInvoiceSync(brandId, row.id, {
    status: inv.status,
    invoiceNumber: inv.detail?.invoice_number || null,
    viewUrl: safePayPalUrl(inv.detail?.metadata?.recipient_view_url) || null,
    dueCents, paidCents, dueOn,
  });
  return { ok: true, ...result, status: inv.status };
}

export async function createDraftInvoice({ brandId, projectId, kind, userId = null, paypal }) {
  const project = await store.getProject(brandId, projectId);
  if (!project) throw new InvoiceError("Project not found.");
  const client = await store.getClient(brandId, project.client_id);
  if (!client) throw new InvoiceError("Client not found.");
  if (!isValidEmail(client.email)) throw new InvoiceError("Save an email address for this client first. PayPal sends the invoice there.");
  const invoiced = await store.invoicedTotalForProject(brandId, projectId);
  const amount = amountForKind(kind, project.quoted_amount_cents, invoiced);
  if (amount === null) {
    throw new InvoiceError(project.quoted_amount_cents ? "That kind of invoice is not available for this project right now. Check what has already been invoiced." : "Add a quoted amount to this project first.");
  }
  const requestId = crypto.randomUUID();
  const rowId = await store.createInvoiceRow(brandId, { projectId, clientId: client.id, kind, amountCents: amount, currency: project.currency, recipientEmail: client.email, requestId });
  return runCreate({ brandId, rowId, project, paypal, userId });
}

async function runCreate({ brandId, rowId, project, paypal, userId }) {
  const row = await store.getInvoiceRow(brandId, rowId);
  try {
    const { id } = await paypal.createInvoice({
      requestId: row.request_id, recipientEmail: row.recipient_email, itemName: project.name,
      itemDescription: row.kind === "deposit" ? "50% deposit" : row.kind === "balance" ? "Remaining balance" : "",
      amountCents: row.amount_cents, currency: row.currency,
    });
    await store.markInvoiceCreated(brandId, rowId, { paypalId: id });
  } catch (err) {
    await store.markInvoiceFailed(brandId, rowId, err.message);
    throw err;
  }
  const fresh = await store.getInvoiceRow(brandId, rowId);
  await reconcileOne(brandId, fresh, paypal); // fills the invoice number and link; harmless if PayPal is slow
  return rowId;
}

/** Retry a draft that failed to create. Reuses the same request id, so PayPal never makes two. */
export async function retryCreate({ brandId, invoiceId, userId = null, paypal }) {
  const row = await store.getInvoiceRow(brandId, invoiceId);
  if (!row) throw new InvoiceError("Invoice not found.");
  if (row.paypal_invoice_id) return invoiceId;
  const project = await store.getProject(brandId, row.project_id);
  return runCreate({ brandId, rowId: invoiceId, project, paypal, userId });
}

/** Emails the invoice. The caller must already have the owner's explicit confirmation. */
export async function sendInvoice({ brandId, invoiceId, userId = null, paypal }) {
  const row = await store.getInvoiceRow(brandId, invoiceId);
  if (!row || !row.paypal_invoice_id) throw new InvoiceError("Create the invoice first.");
  if (statusGroup(row.status) !== "draft") throw new InvoiceError("Only a draft invoice can be sent.");
  await paypal.sendInvoice(row.paypal_invoice_id);
  await store.markInvoiceSent(brandId, invoiceId);
  const fresh = await store.getInvoiceRow(brandId, invoiceId);
  await reconcileOne(brandId, fresh, paypal);
  const client = await store.getClient(brandId, row.client_id);
  if (client?.lead_id) {
    await store.addActivity(brandId, client.lead_id, { kind: "payment", body: `Invoice for ${formatCents(row.amount_cents, row.currency)} sent through PayPal`, userId, metadata: { invoiceId } });
  }
}

export async function reconcileInvoice({ brandId, invoiceId, paypal }) {
  const row = await store.getInvoiceRow(brandId, invoiceId);
  if (!row || !row.paypal_invoice_id) throw new InvoiceError("Invoice not found.");
  return reconcileOne(brandId, row, paypal);
}

/** Re-checks every invoice that is still open. One failure never stops the rest. */
export async function reconcileAll({ brandId, paypal, limit = 50 }) {
  const open = (await store.listInvoices(brandId, { limit: 500 })).filter((r) => r.paypal_invoice_id && OPEN_GROUPS.includes(statusGroup(r.status))).slice(0, limit);
  const summary = { checked: 0, failed: 0, newlyPaid: 0 };
  for (const row of open) {
    const r = await reconcileOne(brandId, row, paypal);
    summary.checked++;
    if (!r.ok) summary.failed++;
    else if (r.becamePaid) summary.newlyPaid++;
  }
  return summary;
}
