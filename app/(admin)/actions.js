"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_BRAND_ID, getBrand } from "@/config/brands";
import * as store from "@/lib/store";
import { runDiscovery } from "@/lib/discovery";
import { buildDraft, isValidEmail, sendProblems, sendViaResend } from "@/lib/email";
import { mockupUrl } from "@/lib/tokens";

// All inputs are validated here, at the server trust boundary.
const BRAND = DEFAULT_BRAND_ID;
const inFlight = new Set();

const done = (path, msg, type = "ok") => redirect(`${path}?${new URLSearchParams({ msg, type })}`);
const lines = (v) => String(v || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const id = z.coerce.number().int().positive();

const discoverySchema = z.object({
  locations: z.array(z.string().min(2).max(80)).min(1).max(10),
  categories: z.array(z.string().min(2).max(60)).min(1).max(10),
  maxPages: z.coerce.number().int().min(1).max(3),
});

export async function discoverAction(formData) {
  const parsed = discoverySchema.safeParse({
    locations: lines(formData.get("locations")),
    categories: lines(formData.get("categories")),
    maxPages: formData.get("maxPages") || 1,
  });
  if (!parsed.success) done("/", "Enter 1 to 10 locations and 1 to 10 categories, one per line.", "bad");
  let result;
  try {
    result = await runDiscovery({ brandId: BRAND, ...parsed.data });
  } catch (err) {
    done("/", err.message, "bad");
  }
  revalidatePath("/", "layout");
  const { searches, found, created, noWebsite, hasWebsite, errors } = result;
  const msg = `Ran ${searches} search(es). ${found} listings found, ${created} new. ${noWebsite} without a real website, ${hasWebsite} with one.${errors.length ? ` ${errors.length} search(es) failed: ${errors[0]}` : ""}`;
  done("/", msg, errors.length && !searches ? "bad" : "ok");
}

async function makeDraft(lead) {
  const brand = getBrand(BRAND);
  const { subject, body } = buildDraft({ lead, brand, mockupLink: mockupUrl(lead.mockup_token) });
  await store.saveDraft(BRAND, lead.id, { subject, body });
}

export async function draftAllAction() {
  const leads = await store.leadsNeedingDraft(BRAND);
  for (const lead of leads) await makeDraft(lead);
  revalidatePath("/", "layout");
  done("/queue", leads.length ? `Created ${leads.length} draft(s) for review.` : "Every no-website lead already has a draft.");
}

export async function createDraftAction(formData) {
  const leadId = id.parse(formData.get("leadId"));
  const lead = await store.getLead(BRAND, leadId);
  if (!lead || lead.bucket !== "no_website") done("/leads", "Drafts are only created for no-website leads.", "bad");
  await makeDraft(lead);
  revalidatePath("/", "layout");
  done(`/leads/${leadId}`, "Draft created. Review it below.");
}

const contactSchema = z.object({
  leadId: id,
  contact_email: z.string().trim().max(200).refine((v) => !v || isValidEmail(v), "Invalid email"),
  notes: z.string().trim().max(2000),
  status: z.enum(["new", "contacted", "skipped", "do_not_contact"]),
});

export async function saveContactAction(formData) {
  const p = contactSchema.safeParse(Object.fromEntries(formData));
  const leadId = Number(formData.get("leadId"));
  if (!p.success) done(`/leads/${leadId}`, "Enter a valid email address (or leave it blank).", "bad");
  const { contact_email, notes, status } = p.data;
  if (contact_email && (await store.isSuppressed(BRAND, contact_email))) {
    await store.updateLeadContact(BRAND, p.data.leadId, { contact_email, notes, status: "do_not_contact" });
    done(`/leads/${leadId}`, "That address has opted out. The lead was marked do not contact.", "bad");
  }
  await store.updateLeadContact(BRAND, p.data.leadId, { contact_email, notes, status });
  revalidatePath("/", "layout");
  done(`/leads/${leadId}`, "Saved.");
}

const draftSchema = z.object({
  leadId: id,
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(8000),
});

export async function saveDraftAction(formData) {
  const leadId = Number(formData.get("leadId"));
  const p = draftSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) done(`/leads/${leadId}`, "Subject (3+ characters) and body (20+ characters) are required.", "bad");
  try {
    await store.saveDraft(BRAND, p.data.leadId, { subject: p.data.subject, body: p.data.body });
  } catch (err) {
    done(`/leads/${leadId}`, err.message, "bad");
  }
  revalidatePath("/", "layout");
  done(`/leads/${leadId}`, "Draft saved and returned to review.");
}

export async function draftStatusAction(formData) {
  const leadId = id.parse(formData.get("leadId"));
  const status = z.enum(["approved", "rejected", "draft"]).parse(formData.get("status"));
  await store.setDraftStatus(BRAND, leadId, status);
  revalidatePath("/", "layout");
  done(`/leads/${leadId}`, status === "approved" ? "Approved. You can now send it manually." : "Draft updated.");
}

export async function sendAction(formData) {
  const leadId = id.parse(formData.get("leadId"));
  const back = `/leads/${leadId}`;
  if (formData.get("reviewed") !== "on") done(back, "Tick the box to confirm you reviewed this exact email.", "bad");
  if (inFlight.has(leadId)) done(back, "A send for this lead is already in progress.", "bad");
  const brand = getBrand(BRAND);
  const lead = await store.getLead(BRAND, leadId);
  const draft = lead && (await store.getDraftByLead(BRAND, leadId));
  const problems = lead ? await sendProblems({ lead, draft, brand, sentToday: await store.countSentToday(BRAND) }) : ["Lead not found."];
  if (problems.length) done(back, `Not sent: ${problems.join(" ")}`, "bad");
  inFlight.add(leadId);
  let error = null;
  try {
    const r = await sendViaResend({ brand, to: lead.contact_email, subject: draft.subject, body: draft.body });
    await store.markDraftSent(BRAND, leadId, { to: lead.contact_email, resendId: r.id });
  } catch (err) {
    error = err.message;
    await store.markDraftSendError(BRAND, leadId, error);
  } finally {
    inFlight.delete(leadId);
  }
  revalidatePath("/", "layout");
  done(back, error ? `Send failed: ${error}` : "Sent.", error ? "bad" : "ok");
}

export async function addSuppressionAction(formData) {
  const email = String(formData.get("email") || "").trim();
  if (!isValidEmail(email)) done("/optouts", "Enter a valid email address.", "bad");
  await store.addSuppression(BRAND, email, "manual (reply or request)");
  revalidatePath("/", "layout");
  done("/optouts", "Added. This address will never be emailed again.");
}
