"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { isValidEmail } from "@/lib/email";
import { safeNext } from "@/lib/safeNext";
import { MANUAL_SOURCES, QUICK_DUE, STAGE_KEYS, LOGGABLE_KINDS, addDays, isDateStr, todayStr } from "@/lib/crm";

// All input is validated here at the server boundary; every read and write is brand scoped in the store.
const id = z.coerce.number().int().positive();
const flash = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const backTo = (fd, fallback) => safeNext(String(fd.get("back") || ""), fallback);
const refresh = () => revalidatePath("/", "layout");

export async function setStageAction(formData) {
  const user = await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const stage = z.enum(STAGE_KEYS).parse(formData.get("stage"));
  const back = backTo(formData, `/leads/${leadId}`);
  let result;
  try {
    result = await store.setStage(BRAND, leadId, stage, { userId: user.id });
  } catch (err) {
    flash(back, err.message, "bad");
  }
  if (result.changed) await audit(BRAND, user.id, "stage_changed", `lead ${leadId} to ${stage}`, (await clientInfo()).ip);
  refresh();
  flash(back, result.changed ? "Stage updated." : "Already at that stage.");
}

export async function addTimelineAction(formData) {
  const user = await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const kind = z.enum(LOGGABLE_KINDS.map(([k]) => k)).parse(formData.get("kind"));
  const body = z.string().trim().min(1).max(4000).safeParse(formData.get("body"));
  const back = `/leads/${leadId}`;
  if (!body.success) flash(back, "Write something to log.", "bad");
  if (!(await store.getLead(BRAND, leadId))) flash("/pipeline", "Contact not found.", "bad");
  await store.addActivity(BRAND, leadId, { kind, body: body.data, userId: user.id });
  refresh();
  flash(back, "Added to the timeline.");
}

export async function addTaskAction(formData) {
  const user = await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  const back = backTo(formData, `/leads/${leadId}`);
  const title = z.string().trim().min(2).max(200).safeParse(formData.get("title"));
  if (!title.success) flash(back, "Give the follow-up a short title.", "bad");
  const quick = Number(formData.get("quick"));
  const picked = String(formData.get("dueOn") || "");
  let dueOn;
  if (isDateStr(picked)) dueOn = picked;
  else if (QUICK_DUE.some(([, d]) => d === quick)) dueOn = addDays(todayStr(), quick);
  else flash(back, "Choose when it is due.", "bad");
  try {
    await store.addTask(BRAND, leadId, { title: title.data, dueOn, userId: user.id });
  } catch (err) {
    flash(back, err.message, "bad");
  }
  refresh();
  flash(back, "Follow-up added.");
}

export async function completeTaskAction(formData) {
  const user = await requireUser();
  await store.completeTask(BRAND, id.parse(formData.get("taskId")), { userId: user.id });
  refresh();
  flash(backTo(formData, "/today"), "Marked done.");
}

export async function snoozeTaskAction(formData) {
  await requireUser();
  const days = Number(formData.get("days"));
  if (!QUICK_DUE.some(([, d]) => d === days)) flash("/today", "Pick a snooze option.", "bad");
  await store.setTaskDue(BRAND, id.parse(formData.get("taskId")), addDays(todayStr(), days));
  refresh();
  flash(backTo(formData, "/today"), "Moved.");
}

export async function saveOwnerNotesAction(formData) {
  await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  await store.setOwnerNotes(BRAND, leadId, String(formData.get("notes") || ""));
  refresh();
  flash(`/leads/${leadId}`, "Notes saved.");
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  email: z.string().trim().max(200).refine((v) => !v || isValidEmail(v), "Enter a valid email address."),
  phone: z.string().trim().max(40).regex(/^[0-9 ()+.\-x]*$/, "Use digits and phone punctuation only."),
  source: z.enum(MANUAL_SOURCES.map(([k]) => k)),
  notes: z.string().trim().max(4000),
});

export async function createContactAction(formData) {
  const user = await requireUser();
  const p = contactSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) flash("/leads/new", p.error.issues[0].message, "bad");
  const existing = p.data.email ? await store.findLeadByEmail(BRAND, p.data.email) : null;
  if (existing) flash(`/leads/${existing.id}`, "A contact with that email already exists. Opened it for you.", "bad");
  const newId = await store.createContact(BRAND, { ...p.data, userId: user.id });
  await audit(BRAND, user.id, "contact_created", `lead ${newId} (${p.data.source})`, (await clientInfo()).ip);
  refresh();
  flash(`/leads/${newId}`, "Contact added.");
}
