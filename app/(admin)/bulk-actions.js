"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { BULK_ACTIONS, parseBulk } from "@/lib/bulk";
import { safeNext } from "@/lib/safeNext";

const go = (back, msg, type = "ok") => redirect(`${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);

/** Do one checked thing to the contacts that were ticked. */
export async function bulkLeadsAction(formData) {
  const user = await requireUser();
  const requested = safeNext(String(formData.get("back") || ""), "/leads");
  const back = requested.startsWith("/leads") ? requested : "/leads";
  const parsed = parseBulk({ ids: formData.getAll("ids"), action: formData.get("action"), tag: formData.get("tag"), stage: formData.get("stage") });
  if (!parsed.ok) go(back, parsed.error, "bad");
  const r = await store.bulkUpdateLeads(BRAND, parsed.value, { userId: user.id });
  await audit(BRAND, user.id, "bulk_update", `${parsed.value.action}: ${r.changed} of ${r.total} contacts`, (await clientInfo()).ip);
  revalidatePath("/", "layout");
  const label = BULK_ACTIONS.find(([k]) => k === parsed.value.action)[1].toLowerCase();
  go(back, r.changed ? `Updated ${r.changed} of ${r.total} selected contacts (${label}).` : "Nothing changed. Those contacts were already that way, or did not qualify.", r.changed ? "ok" : "bad");
}
