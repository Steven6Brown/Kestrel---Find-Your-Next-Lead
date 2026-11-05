"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { isValidEmail } from "@/lib/email";
import {
  CLIENT_STATUSES, MEETING_LOCATIONS, MEETING_TITLES, PROJECT_STATUSES, PROJECT_TYPES, isDateStr, localInputToIso, parseMoneyToCents,
} from "@/lib/crm";

// Every input is validated here; every store call is scoped by brand and re-checks ownership.
const id = z.coerce.number().int().positive();
const flash = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const refresh = () => revalidatePath("/", "layout");
const keys = (list) => list.map(([k]) => k);
const optionalDate = (v) => (isDateStr(v) ? String(v) : null);

const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  email: z.string().trim().max(200).refine((v) => !v || isValidEmail(v), "Enter a valid email address."),
  phone: z.string().trim().max(40).regex(/^[0-9 ()+.\-x]*$/, "Use digits and phone punctuation only."),
  notes: z.string().trim().max(4000),
});

export async function createClientAction(formData) {
  const user = await requireUser();
  const p = clientSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) flash("/clients/new", p.error.issues[0].message, "bad");
  const newId = await store.createClient(BRAND, p.data);
  await audit(BRAND, user.id, "client_created", `client ${newId}`, (await clientInfo()).ip);
  refresh();
  flash(`/clients/${newId}`, "Client added.");
}

export async function convertToClientAction(formData) {
  const user = await requireUser();
  const leadId = id.parse(formData.get("leadId"));
  let result;
  try {
    result = await store.convertToClient(BRAND, leadId, { userId: user.id });
  } catch (err) {
    flash(`/leads/${leadId}`, err.message, "bad");
  }
  if (result.created) await audit(BRAND, user.id, "client_created", `from contact ${leadId}`, (await clientInfo()).ip);
  refresh();
  flash(`/clients/${result.id}`, result.created ? "Converted to a client. The contact is now marked won." : "Already a client.");
}

export async function setClientStatusAction(formData) {
  await requireUser();
  const clientId = id.parse(formData.get("clientId"));
  await store.setClientStatus(BRAND, clientId, z.enum(keys(CLIENT_STATUSES)).parse(formData.get("status")));
  refresh();
  flash(`/clients/${clientId}`, "Status updated.");
}

export async function saveClientNotesAction(formData) {
  await requireUser();
  const clientId = id.parse(formData.get("clientId"));
  await store.setClientNotes(BRAND, clientId, String(formData.get("notes") || ""));
  refresh();
  flash(`/clients/${clientId}`, "Notes saved.");
}

const projectSchema = z.object({
  clientId: id,
  name: z.string().trim().min(2, "Give the project a name.").max(160),
  type: z.enum(keys(PROJECT_TYPES)),
  status: z.enum(keys(PROJECT_STATUSES)),
  amount: z.string().trim().max(20),
  notes: z.string().trim().max(4000),
});

export async function createProjectAction(formData) {
  const user = await requireUser();
  const p = projectSchema.safeParse(Object.fromEntries(formData));
  const clientId = Number(formData.get("clientId"));
  if (!p.success) flash(`/clients/${clientId}`, p.error.issues[0].message, "bad");
  let quotedCents = null;
  if (p.data.amount) {
    quotedCents = parseMoneyToCents(p.data.amount);
    if (quotedCents === null) flash(`/clients/${clientId}`, "Enter the quoted amount as a plain number, like 1500 or 1500.50.", "bad");
  }
  try {
    const projectId = await store.createProject(BRAND, p.data.clientId, {
      name: p.data.name, type: p.data.type, status: p.data.status, quotedCents,
      startOn: optionalDate(formData.get("startOn")), targetOn: optionalDate(formData.get("targetOn")), notes: p.data.notes,
    });
    await audit(BRAND, user.id, "project_created", `project ${projectId} for client ${p.data.clientId}`, (await clientInfo()).ip);
  } catch (err) {
    flash(`/clients/${clientId}`, err.message, "bad");
  }
  refresh();
  flash(`/clients/${clientId}`, "Project added.");
}

export async function setProjectStatusAction(formData) {
  await requireUser();
  const clientId = id.parse(formData.get("clientId"));
  await store.setProjectStatus(BRAND, id.parse(formData.get("projectId")), z.enum(keys(PROJECT_STATUSES)).parse(formData.get("status")));
  refresh();
  flash(`/clients/${clientId}`, "Project updated.");
}

export async function logMeetingAction(formData) {
  const user = await requireUser();
  const leadId = formData.get("leadId") ? id.parse(formData.get("leadId")) : null;
  const clientId = formData.get("clientId") ? id.parse(formData.get("clientId")) : null;
  const back = leadId ? `/leads/${leadId}` : `/clients/${clientId}`;
  const title = z.enum(MEETING_TITLES).safeParse(formData.get("title"));
  const location = z.enum(keys(MEETING_LOCATIONS)).safeParse(formData.get("location"));
  const startsAt = localInputToIso(String(formData.get("startsAt") || ""));
  if (!title.success || !location.success) flash(back, "Choose what kind of meeting and where.", "bad");
  if (!startsAt) flash(back, "Pick the date and time.", "bad");
  try {
    const meetingId = await store.createMeeting(BRAND, {
      leadId, clientId, title: title.data, location: location.data, startsAt,
      notes: String(formData.get("notes") || "").slice(0, 2000), userId: user.id,
    });
    await audit(BRAND, user.id, "meeting_logged", `meeting ${meetingId}`, (await clientInfo()).ip);
  } catch (err) {
    flash(back, err.message, "bad");
  }
  refresh();
  flash(back, "Meeting saved.");
}

export async function setMeetingStatusAction(formData) {
  await requireUser();
  await store.setMeetingStatus(BRAND, id.parse(formData.get("meetingId")), z.enum(["scheduled", "done", "cancelled"]).parse(formData.get("status")));
  refresh();
  flash("/meetings", "Meeting updated.");
}
