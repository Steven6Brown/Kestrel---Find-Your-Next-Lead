"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { hrefWith, parseFilters } from "@/lib/leadfilters";

/** Save the filters you are looking at under a name. The address is rebuilt from the cleaned filters, never taken as sent. */
export async function saveViewAction(formData) {
  const user = await requireUser();
  const href = hrefWith("/leads", parseFilters(Object.fromEntries(formData)), { page: 1 });
  const r = await store.saveView(BRAND, formData.get("viewName"), href, user.id);
  revalidatePath("/", "layout");
  const back = r.saved ? href : "/leads";
  redirect(`${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams({ msg: r.saved ? "View saved." : r.reason, type: r.saved ? "ok" : "bad" })}`);
}

export async function deleteViewAction(formData) {
  await requireUser();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id) && id > 0) await store.deleteView(BRAND, id);
  revalidatePath("/", "layout");
  redirect("/leads?msg=View+removed.&type=ok");
}
