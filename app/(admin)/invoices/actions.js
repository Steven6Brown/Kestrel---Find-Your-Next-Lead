"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { paypalClient, PayPalError } from "@/lib/paypal";
import { InvoiceError, createDraftInvoice, reconcileAll, reconcileInvoice, retryCreate, sendInvoice } from "@/lib/invoicing";
import { INVOICE_KINDS } from "@/lib/invoicestatus";
import { safeNext } from "@/lib/safeNext";

// Money actions are owner and administrator only. Amounts are computed on the server from the
// project's quoted amount; nothing about money is taken from the form except which kind of
// invoice, and every id is checked against the brand.
const managers = { roles: ["owner", "admin"] };
const id = z.coerce.number().int().positive();
const flash = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const refresh = () => revalidatePath("/", "layout");
const friendly = (e) => (e instanceof PayPalError || e instanceof InvoiceError ? e.message : "Something went wrong. Nothing was sent or charged.");
const backTo = (fd, fallback) => safeNext(String(fd.get("back") || ""), fallback);

async function withPayPal(back, fn) {
  let result;
  try {
    result = await fn(paypalClient());
  } catch (e) {
    flash(back, friendly(e), "bad");
  }
  return result;
}

export async function createInvoiceAction(formData) {
  const user = await requireUser(managers);
  const projectId = id.parse(formData.get("projectId"));
  const kind = z.enum(INVOICE_KINDS.map(([k]) => k)).parse(formData.get("kind"));
  const project = await store.getProject(BRAND, projectId);
  const back = project ? `/clients/${project.client_id}` : "/clients";
  const invoiceId = await withPayPal(back, (paypal) => createDraftInvoice({ brandId: BRAND, projectId, kind, userId: user.id, paypal }));
  await audit(BRAND, user.id, "invoice_created", `invoice ${invoiceId} for project ${projectId}`, (await clientInfo()).ip);
  refresh();
  flash(back, "Draft invoice created in PayPal. Review it, then send it when you are ready.");
}

export async function retryInvoiceAction(formData) {
  const user = await requireUser(managers);
  const invoiceId = id.parse(formData.get("invoiceId"));
  const back = backTo(formData, "/invoices");
  await withPayPal(back, (paypal) => retryCreate({ brandId: BRAND, invoiceId, userId: user.id, paypal }));
  refresh();
  flash(back, "Draft invoice created in PayPal.");
}

export async function sendInvoiceAction(formData) {
  const user = await requireUser(managers);
  const invoiceId = id.parse(formData.get("invoiceId"));
  const back = backTo(formData, "/invoices");
  if (formData.get("reviewed") !== "on") flash(back, "Tick the box to confirm you reviewed this invoice and the client's email.", "bad");
  await withPayPal(back, (paypal) => sendInvoice({ brandId: BRAND, invoiceId, userId: user.id, paypal }));
  await audit(BRAND, user.id, "invoice_sent", `invoice ${invoiceId}`, (await clientInfo()).ip);
  refresh();
  flash(back, "Invoice sent. PayPal emailed it to the client.");
}

export async function refreshInvoiceAction(formData) {
  await requireUser(managers);
  const invoiceId = id.parse(formData.get("invoiceId"));
  const back = backTo(formData, "/invoices");
  const r = await withPayPal(back, (paypal) => reconcileInvoice({ brandId: BRAND, invoiceId, paypal }));
  refresh();
  flash(back, r.ok ? (r.becamePaid ? "Paid. Added to the timeline." : "Status refreshed.") : "Payment status unavailable right now. Try again shortly.", r.ok ? "ok" : "bad");
}

export async function reconcileAllAction(formData) {
  const user = await requireUser(managers);
  const back = backTo(formData, "/invoices");
  const s = await withPayPal(back, (paypal) => reconcileAll({ brandId: BRAND, paypal }));
  await audit(BRAND, user.id, "invoices_reconciled", `${s.checked} checked, ${s.newlyPaid} newly paid, ${s.failed} failed`, (await clientInfo()).ip);
  refresh();
  flash(back, s.checked === 0 ? "No open invoices to check." : `Checked ${s.checked} invoice(s): ${s.newlyPaid} newly paid${s.failed ? `, ${s.failed} could not be checked` : ""}.`, s.failed ? "bad" : "ok");
}
