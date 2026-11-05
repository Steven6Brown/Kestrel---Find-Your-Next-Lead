"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { getConnector } from "@/lib/connectors";

// Owner and administrators only. Provider ids come from an allowlist (the connector registry);
// credentials never pass through here: env connectors read them from the server environment.
const managers = { roles: ["owner", "admin"] };
const flash = (msg, type = "ok") => redirect(`/connections?${new URLSearchParams({ msg, type })}`);
const refresh = () => revalidatePath("/connections");

export async function saveBookingLinkAction(formData) {
  const user = await requireUser(managers);
  const c = getConnector("booking_link");
  const v = c.validate(String(formData.get("url") || ""));
  if (!v.ok) flash(v.error, "bad");
  await store.saveConnection(BRAND, c.id, { status: "connected", config: { url: v.value } });
  await audit(BRAND, user.id, "connection_connected", c.id, (await clientInfo()).ip);
  refresh();
  flash("Booking link saved. It will appear in new outreach drafts and on concept pages.");
}

export async function testConnectionAction(formData) {
  const user = await requireUser(managers);
  const c = getConnector(String(formData.get("provider") || ""));
  if (!c || c.mode === "unavailable") flash("That connection cannot be tested.", "bad");
  const connection = await store.getConnection(BRAND, c.id);
  let result;
  try {
    result = await c.check({ env: process.env, connection });
  } catch {
    result = { ok: false, message: "The check failed unexpectedly. Nothing was changed." }; // connectors should not throw, but never leak if one does
  }
  await store.recordConnectionCheck(BRAND, c.id, result);
  await audit(BRAND, user.id, "connection_checked", `${c.id}: ${result.ok ? "ok" : "failed"}`, (await clientInfo()).ip);
  refresh();
  flash(`${c.name}: ${result.message}`, result.ok ? "ok" : "bad");
}

export async function disconnectAction(formData) {
  const user = await requireUser(managers);
  const c = getConnector(String(formData.get("provider") || ""));
  if (!c || c.mode === "unavailable") flash("That connection cannot be changed.", "bad");
  await store.disconnectConnection(BRAND, c.id);
  await audit(BRAND, user.id, "connection_disconnected", c.id, (await clientInfo()).ip);
  refresh();
  flash(`${c.name} disconnected. Anything saved for it was erased.`);
}
