"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";

// Owners and admins only: a merge deletes a contact, so it is never one click for everyone.
const ROLES = ["owner", "admin"];
const go = (msg, type = "ok") => redirect(`/leads/duplicates?${new URLSearchParams({ msg, type })}`);

function idsFrom(formData) {
  const ids = [...new Set(formData.getAll("ids").map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  return ids.length >= 2 && ids.length <= 10 ? ids : [];
}

/** Merge every other contact in a group into the one chosen to keep. */
export async function mergeDuplicatesAction(formData) {
  const user = await requireUser({ roles: ROLES });
  const ids = idsFrom(formData);
  const keep = Number(formData.get("keep"));
  if (!ids.length || !ids.includes(keep)) go("Choose which contact to keep.", "bad");
  let merged = 0;
  const problems = [];
  for (const id of ids.filter((i) => i !== keep)) {
    const r = await store.mergeLeads(BRAND, keep, id, { userId: user.id });
    if (r.merged) merged++;
    else problems.push(r.reason);
  }
  if (merged) await audit(BRAND, user.id, "contacts_merged", `kept contact ${keep}, merged ${merged}`, (await clientInfo()).ip);
  revalidatePath("/", "layout");
  if (problems.length) go(`${merged ? `Merged ${merged}. ` : ""}${problems[0]}`, "bad");
  go(`Merged ${merged} duplicate${merged === 1 ? "" : "s"} into the contact you kept. Their timeline, follow-ups, deals and details moved with them.`);
}

/** These contacts are different businesses: never offer them as duplicates again. */
export async function dismissDuplicatesAction(formData) {
  await requireUser({ roles: ROLES });
  const ids = idsFrom(formData);
  if (!ids.length) go("Nothing to dismiss.", "bad");
  await store.dismissDuplicates(BRAND, ids);
  revalidatePath("/", "layout");
  go("Got it. These will not be offered as duplicates again.");
}
