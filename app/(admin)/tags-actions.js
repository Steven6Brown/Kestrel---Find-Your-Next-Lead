"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { normalizeTag, parseTagList } from "@/lib/tags";

const go = (leadId, msg, type = "ok") => redirect(`/leads/${leadId}?${new URLSearchParams({ msg, type })}`);
const leadIdOf = (fd) => {
  const n = Number(fd.get("leadId"));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Add tags typed into the box and/or picked from the suggestions. */
export async function addTagsAction(formData) {
  await requireUser();
  const leadId = leadIdOf(formData);
  if (!leadId) redirect("/leads?msg=That+contact+was+not+found.&type=bad");
  const tags = [...parseTagList(formData.get("tags")), ...formData.getAll("pick").map(normalizeTag)].filter(Boolean);
  if (!tags.length) go(leadId, "Type a tag or pick one.", "bad");
  const added = await store.addTags(BRAND, leadId, tags);
  revalidatePath("/", "layout");
  go(leadId, added ? `Added ${added} tag${added === 1 ? "" : "s"}.` : "Nothing new to add. A contact can hold 20 tags.", added ? "ok" : "bad");
}

export async function removeTagAction(formData) {
  await requireUser();
  const leadId = leadIdOf(formData);
  if (!leadId) redirect("/leads?msg=That+contact+was+not+found.&type=bad");
  await store.removeTag(BRAND, leadId, String(formData.get("tag") || ""));
  revalidatePath("/", "layout");
  go(leadId, "Tag removed.");
}
