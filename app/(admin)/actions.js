"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_BRAND_ID, getBrand } from "@/config/brands";
import * as store from "@/lib/store";
import { after } from "next/server";
import { startRun } from "@/lib/runner";
import { startVerification } from "@/lib/verify";
import { startAudit } from "@/lib/auditrun";
import { areaCampaignName, validateAreaCampaign } from "@/lib/campaigns";
import { buildDraft, buildRedesignDraft, isValidEmail, sendProblems, sendViaResend } from "@/lib/email";
import { mockupUrl } from "@/lib/tokens";
import { requireUser } from "@/lib/auth";
import { parseFilters } from "@/lib/leadfilters";
import { isRedesignLead, parseThreshold } from "@/lib/redesign";
import { safeNext } from "@/lib/safeNext";

// All inputs are validated here, at the server trust boundary.
const BRAND = DEFAULT_BRAND_ID;
const inFlight = new Set();

const done = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const lines = (v) => String(v || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const id = z.coerce.number().int().positive();

// ---------- campaigns (every input is a pick from a fixed list) ----------

export async function createCampaignAction(formData) {
  await requireUser();
  const v = validateAreaCampaign({
    locations: formData.getAll("locations").map(String),
    frequency: String(formData.get("frequency") || "manual"),
    run_time: String(formData.get("run_time") || "06:00"),
  });
  const state = /^[A-Z]{2}$/.test(String(formData.get("state"))) ? String(formData.get("state")) : "";
  if (!v.ok) done(`/campaigns/new${state ? `?state=${state}` : ""}`, v.error, "bad");
  const newId = await store.createCampaign(BRAND, { name: areaCampaignName(v.value.locations), ...v.value });
  revalidatePath("/", "layout");
  done(`/campaigns/${newId}`, "Campaign saved. Press Run now to start scanning.");
}

export async function runCampaignAction(formData) {
  await requireUser();
  const campaignId = id.parse(formData.get("campaignId"));
  const campaign = await store.getCampaign(BRAND, campaignId);
  if (!campaign) done("/campaigns", "Campaign not found.", "bad");
  const r = await startRun({ brandId: BRAND, campaign, trigger: "manual" });
  if (r.skipped) done(`/campaigns/${campaignId}`, r.reason, "bad");
  after(() => r.done);
  revalidatePath("/", "layout");
  done(`/campaigns/${campaignId}`, "Scan started. This page shows the result under Run history when it finishes (a few minutes for large campaigns).");
}

export async function toggleCampaignAction(formData) {
  await requireUser();
  const campaignId = id.parse(formData.get("campaignId"));
  await store.setCampaignEnabled(BRAND, campaignId, formData.get("enabled") === "true");
  revalidatePath("/", "layout");
  done(`/campaigns/${campaignId}`, "Updated.");
}

export async function deleteCampaignAction(formData) {
  await requireUser();
  const campaignId = id.parse(formData.get("campaignId"));
  await store.deleteCampaign(BRAND, campaignId);
  revalidatePath("/", "layout");
  done("/campaigns", "Campaign deleted. Remove its Task Scheduler job too if you registered one.");
}

async function makeDraft(lead) {
  const brand = getBrand(BRAND);
  const bookingLink = (await store.getBookingUrl(BRAND)) || "";
  const build = lead.bucket === "has_website" ? buildRedesignDraft : buildDraft;
  const { subject, body } = build({ lead, brand, mockupLink: mockupUrl(lead.mockup_token), bookingLink });
  await store.saveDraft(BRAND, lead.id, { subject, body });
}

export async function siteCheckAction(formData) {
  await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const verdict = z.enum(["confirmed_none", "has_site"]).parse(formData.get("verdict"));
  await store.setSiteCheck(BRAND, leadId, verdict);
  revalidatePath("/", "layout");
  const backTo = String(formData.get("back") || "");
  const dest = backTo.startsWith("/leads") ? safeNext(backTo, `/leads/${leadId}`) : `/leads/${leadId}`;
  done(dest, verdict === "confirmed_none" ? "Marked as confirmed: no website. You can now draft outreach." : "Marked as having a website. It moved to the redesign list.");
}

export async function createDraftAction(formData) {
  await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const lead = await store.getLead(BRAND, leadId);
  if (lead?.closed_at) done(`/leads/${leadId}`, "This business is marked closed, so no outreach can be drafted. Reopen it first if that was a mistake.", "bad");
  const redesign = isRedesignLead(lead);
  if (!lead || (lead.bucket !== "no_website" && !redesign)) done("/leads", "Drafts are only created for no-website leads and for websites that have been scored.", "bad");
  if (!redesign && !store.outreachReady(lead)) done(`/leads/${leadId}`, "Check that this business really has no website first (OpenStreetMap data is often incomplete).", "bad");
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
  await requireUser();
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
  await requireUser();
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
  await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const status = z.enum(["approved", "rejected", "draft"]).parse(formData.get("status"));
  await store.setDraftStatus(BRAND, leadId, status);
  revalidatePath("/", "layout");
  done(`/leads/${leadId}`, status === "approved" ? "Approved. You can now send it manually." : "Draft updated.");
}

export async function sendAction(formData) {
  await requireUser({ roles: ["owner", "admin"] });
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
  await requireUser();
  const email = String(formData.get("email") || "").trim();
  if (!isValidEmail(email)) done("/optouts", "Enter a valid email address.", "bad");
  await store.addSuppression(BRAND, email, "manual (reply or request)");
  revalidatePath("/", "layout");
  done("/optouts", "Added. This address will never be emailed again.");
}

/** Create drafts for every lead in the current filter that is ready and has no draft yet (up to 200). */
export async function draftFilteredAction(formData) {
  await requireUser();
  const f = parseFilters(Object.fromEntries(formData));
  const leads = await store.draftableInFilter(BRAND, f, 200);
  for (const lead of leads) await makeDraft(lead);
  revalidatePath("/", "layout");
  done("/queue", leads.length ? `Created ${leads.length} draft(s) from your filter. Review them here before anything is sent.` : "No ready leads in this filter need a draft. Leads from OpenStreetMap must be checked first.", leads.length ? "ok" : "bad");
}

/** Look up every unverified lead in the free open dataset, in the background. */
export async function verifyWebsitesAction() {
  await requireUser();
  if ((await store.countWaitingForLookup(BRAND)) === 0) done("/leads", "Nothing new to look up. Businesses that were already looked up and not found stay unverified until you check them by hand.", "bad");
  const r = await startVerification({ brandId: BRAND });
  if (r.skipped) done("/leads", r.reason, "bad");
  after(() => r.done);
  revalidatePath("/", "layout");
  done("/leads", "Website check started. Progress shows below and on the Scanner page under Recent runs. It usually takes a few minutes.");
}

/** Score the websites of every lead that has one, in the background. */
export async function auditWebsitesAction() {
  await requireUser();
  const r = await startAudit({ brandId: BRAND });
  if (r.skipped) done("/redesign", r.reason, "bad");
  after(() => r.done);
  revalidatePath("/", "layout");
  done("/redesign", "Website quality check started. Progress shows below and on the Scanner page under Recent runs.");
}

/** Create redesign drafts for every scored site below the chosen cutoff that has no draft yet (up to 200). */
export async function draftRedesignAction(formData) {
  await requireUser();
  const below = parseThreshold(formData.get("below"));
  const leads = await store.redesignNeedingDraft(BRAND, below, 200);
  for (const lead of leads) await makeDraft(lead);
  revalidatePath("/", "layout");
  done("/queue", leads.length ? `Created ${leads.length} redesign draft(s). Review them here before anything is sent.` : "Every site below this cutoff already has a draft.", leads.length ? "ok" : "bad");
}

/** Mark a business as permanently closed, or reopen it. */
export async function setClosedAction(formData) {
  const user = await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const closed = formData.get("closed") === "1";
  const ok = await store.setClosed(BRAND, leadId, closed, { userId: user.id });
  if (!ok) done("/leads", "That business was not found.", "bad");
  revalidatePath("/", "layout");
  const backTo = String(formData.get("back") || "");
  const dest = backTo.startsWith("/leads") ? safeNext(backTo, `/leads/${leadId}`) : `/leads/${leadId}`;
  done(dest, closed ? "Marked as closed. It is now hidden from lead lists, website checks and outreach. Any unsent draft was rejected." : "Reopened. It is back in the lead lists.");
}
