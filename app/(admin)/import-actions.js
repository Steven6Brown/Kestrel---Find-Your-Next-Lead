"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import * as store from "@/lib/store";
import { audit } from "@/lib/users";
import { MANUAL_SOURCES } from "@/lib/crm";
import { MAX_CHARS, analyzeCsv } from "@/lib/csvimport";
import { parseTagList } from "@/lib/tags";

const fail = (path, msg) => redirect(`${path}?${new URLSearchParams({ msg, type: "bad" })}`);
const MAX_FILE_BYTES = 2_500_000;

/** Take the uploaded file, check it can be read, and park it for the preview. Nothing is imported yet. */
export async function uploadImportAction(formData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!file || typeof file === "string" || !file.size) fail("/leads/import", "Choose a CSV file first.");
  if (file.size > MAX_FILE_BYTES) fail("/leads/import", "That file is too large. Split it into smaller files.");
  const source = MANUAL_SOURCES.some(([k]) => k === formData.get("source")) ? formData.get("source") : "";
  if (!source) fail("/leads/import", "Choose where these contacts came from.");
  const text = await file.text();
  if (text.length > MAX_CHARS) fail("/leads/import", "That file is too large. Split it into smaller files.");
  const check = analyzeCsv(text, []);
  if (!check.ok) fail("/leads/import", check.error);
  const id = await store.createImportBatch(BRAND, { userId: user.id, source, tagAll: parseTagList(formData.get("tagAll")).join(","), csv: text });
  redirect(`/leads/import/${id}`);
}

/** Import the rows that are new. The file is checked again here against the contacts as they are now. */
export async function importBatchAction(formData) {
  const user = await requireUser();
  const id = Number(formData.get("batchId"));
  const batch = Number.isInteger(id) && id > 0 ? await store.getImportBatch(BRAND, id) : null;
  if (!batch) fail("/leads/import", "That import is no longer available. Upload the file again.");
  const result = analyzeCsv(batch.csv, await store.importComparisonLeads(BRAND));
  if (!result.ok) fail("/leads/import", result.error);
  const rows = result.rows.filter((r) => r.status === "new");
  const ids = await store.importContacts(BRAND, rows, { source: batch.source, tagAll: parseTagList(batch.tag_all), userId: user.id });
  await store.deleteImportBatch(BRAND, id);
  await audit(BRAND, user.id, "contacts_imported", `${ids.length} contacts from a CSV file`, (await clientInfo()).ip);
  revalidatePath("/", "layout");
  const skipped = result.counts.duplicate;
  const bad = result.counts.invalid;
  redirect(`/leads?${new URLSearchParams({
    site: "any",
    msg: `Imported ${ids.length} contact${ids.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} already ${skipped === 1 ? "existed and was" : "existed and were"} skipped.` : ""}${bad ? ` ${bad} ${bad === 1 ? "had a problem and was" : "had problems and were"} left out.` : ""}`,
    type: "ok",
  })}`);
}

export async function cancelImportAction(formData) {
  await requireUser();
  const id = Number(formData.get("batchId"));
  if (Number.isInteger(id) && id > 0) await store.deleteImportBatch(BRAND, id);
  redirect("/leads/import?msg=Import+cancelled.+Nothing+was+added.&type=ok");
}
