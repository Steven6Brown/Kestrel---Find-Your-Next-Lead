"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import { deleteContact } from "@/lib/privacy";

/** Permanently delete one contact, after an explicit confirmation. Owners and admins only. */
export async function deleteContactAction(formData) {
  const user = await requireUser({ roles: ["owner", "admin"] });
  const leadId = Number(formData.get("leadId"));
  if (!Number.isInteger(leadId) || leadId <= 0) redirect("/leads?msg=That+contact+was+not+found.&type=bad");
  if (formData.get("confirm") !== "yes") {
    redirect(`/leads/${leadId}/delete?msg=${encodeURIComponent("Tick the box to confirm. Nothing was deleted.")}&type=bad`);
  }
  const r = await deleteContact({ brandId: BRAND, leadId, userId: user.id, ip: (await clientInfo()).ip });
  revalidatePath("/", "layout");
  if (!r.deleted) redirect(`/leads/${leadId}/delete?msg=${encodeURIComponent(r.reason)}&type=bad`);
  redirect(`/leads?msg=${encodeURIComponent("Contact deleted. Their email address stays on the do not contact list so they are never emailed again.")}&type=ok`);
}
