"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { LOST_REASONS, OPEN_DEAL_STAGES, validateDealInput } from "@/lib/deals";
import { safeNext } from "@/lib/safeNext";

// Every value is checked here (lib/deals.js) and again by the database; every read and write is brand scoped in the store.
const num = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const go = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const refresh = () => revalidatePath("/", "layout");

/** Add a deal to a contact. */
export async function createDealAction(formData) {
  const user = await requireUser();
  const leadId = num(formData.get("leadId"));
  if (!leadId) go("/deals/new", "Choose a contact for the deal.", "bad");
  const stage = OPEN_DEAL_STAGES.includes(formData.get("stage")) ? formData.get("stage") : "discovery";
  const v = validateDealInput(Object.fromEntries(formData), { stage });
  if (!v.ok) go(`/deals/new?lead=${leadId}`, v.errors.join(" "), "bad");
  let id;
  try {
    id = await store.createDeal(BRAND, leadId, { ...v.value, stage, userId: user.id });
  } catch (err) {
    go("/deals/new", err.message, "bad");
  }
  refresh();
  go(`/deals/${id}`, "Deal added.");
}

/** Edit an open deal. */
export async function updateDealAction(formData) {
  await requireUser();
  const id = num(formData.get("dealId"));
  const deal = id ? await store.getDeal(BRAND, id) : null;
  if (!deal) go("/deals", "That deal was not found.", "bad");
  const v = validateDealInput(Object.fromEntries(formData), { stage: deal.stage });
  if (!v.ok) go(`/deals/${id}`, v.errors.join(" "), "bad");
  const ok = await store.updateDeal(BRAND, id, v.value);
  refresh();
  go(`/deals/${id}`, ok ? "Deal updated." : "Only an open deal can be edited.", ok ? "ok" : "bad");
}

/** Move an open deal to another open stage, from the board or the deal page. */
export async function moveDealAction(formData) {
  const user = await requireUser();
  const id = num(formData.get("dealId"));
  const back = safeNext(String(formData.get("back") || ""), id ? `/deals/${id}` : "/deals");
  if (!id) go("/deals", "That deal was not found.", "bad");
  let r;
  try {
    r = await store.moveDeal(BRAND, id, String(formData.get("stage") || ""), { userId: user.id });
  } catch (err) {
    go(back, err.message, "bad");
  }
  refresh();
  go(back, r.changed ? "Deal moved." : "Already at that stage.");
}

/** Win a deal: the contact becomes a client with a project at the deal's amount. */
export async function winDealAction(formData) {
  const user = await requireUser();
  const id = num(formData.get("dealId"));
  if (!id) go("/deals", "That deal was not found.", "bad");
  let r;
  try {
    r = await store.winDeal(BRAND, id, { userId: user.id });
  } catch (err) {
    go("/deals", err.message, "bad");
  }
  if (!r.won) go(`/deals/${id}`, r.reason, "bad");
  await audit(BRAND, user.id, "deal_won", `deal ${id}`, (await clientInfo()).ip);
  refresh();
  go(`/clients/${r.clientId}`, "Deal won. The contact is now a client, and a project was created from the deal.");
}

/** Lose a deal. A reason is required. */
export async function loseDealAction(formData) {
  const user = await requireUser();
  const id = num(formData.get("dealId"));
  if (!id) go("/deals", "That deal was not found.", "bad");
  const reason = String(formData.get("reason") || "");
  if (!LOST_REASONS.some(([k]) => k === reason)) go(`/deals/${id}`, "Choose why the deal was lost.", "bad");
  let r;
  try {
    r = await store.loseDeal(BRAND, id, reason, { userId: user.id });
  } catch (err) {
    go(`/deals/${id}`, err.message, "bad");
  }
  await audit(BRAND, user.id, "deal_lost", `deal ${id}`, (await clientInfo()).ip);
  refresh();
  go(`/deals/${id}`, r.lost ? "Deal marked as lost." : "That deal is already closed.", r.lost ? "ok" : "bad");
}

/** A lost deal goes back to Discovery. */
export async function reopenDealAction(formData) {
  const user = await requireUser();
  const id = num(formData.get("dealId"));
  if (!id) go("/deals", "That deal was not found.", "bad");
  const ok = await store.reopenDeal(BRAND, id, { userId: user.id });
  refresh();
  go(`/deals/${id}`, ok ? "Deal reopened." : "Only a lost deal can be reopened.", ok ? "ok" : "bad");
}
