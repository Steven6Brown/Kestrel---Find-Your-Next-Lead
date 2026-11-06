// Privacy requests for one contact: a full export (what we hold about them) and a safe delete.
// Everything is scoped to one brand. Delete keeps only what is needed to honor the request:
// the email address goes on the do not contact list and the public place id is remembered, so a later scan
// cannot quietly bring the business back and email it again. Neither is a copy of the person's details.
import { query } from "./db.js";
import { addSuppression, getLead } from "./store.js";
import { audit } from "./users.js";

const one = (rows) => rows[0] || null;

/** Everything held about one contact, as plain data for a download. Returns null when there is no such contact. */
export async function contactExport(brandId, leadId) {
  const lead = await getLead(brandId, leadId);
  if (!lead) return null;
  const { mockup_token: _token, ...fields } = lead; // a private link, not information about the person
  const client = one(await query("SELECT * FROM clients WHERE brand_id = ? AND lead_id = ?", [brandId, leadId]));
  const [drafts, activities, tasks, meetings, projects, invoices, suppressed, deals] = await Promise.all([
    query("SELECT id, subject, body, status, kind, created_at, approved_at, sent_at, sent_to FROM drafts WHERE brand_id = ? AND lead_id = ?", [brandId, leadId]),
    query("SELECT id, kind, body, metadata, created_at FROM activities WHERE brand_id = ? AND lead_id = ? ORDER BY id", [brandId, leadId]),
    query("SELECT id, title, due_on, done_at, created_at FROM tasks WHERE brand_id = ? AND lead_id = ? ORDER BY id", [brandId, leadId]),
    query("SELECT id, title, location, starts_at, status, notes FROM meetings WHERE brand_id = ? AND (lead_id = ? OR client_id = ?) ORDER BY starts_at", [brandId, leadId, client?.id ?? -1]),
    client ? query("SELECT id, name, type, status, quoted_amount_cents, currency, start_on, target_on, notes, created_at FROM projects WHERE brand_id = ? AND client_id = ? ORDER BY id", [brandId, client.id]) : [],
    client ? query("SELECT id, kind, amount_cents, currency, recipient_email, invoice_number, status, due_on, created_at, sent_at, paid_at FROM invoices WHERE brand_id = ? AND client_id = ? ORDER BY id", [brandId, client.id]) : [],
    lead.contact_email ? query("SELECT email, reason, created_at FROM suppressions WHERE brand_id = ? AND email = ?", [brandId, String(lead.contact_email).trim().toLowerCase()]) : [],
    query("SELECT id, title, type, amount_cents, probability, stage, expected_close_on, lost_reason, created_at, closed_at FROM deals WHERE brand_id = ? AND lead_id = ? ORDER BY id", [brandId, leadId]),
  ]);
  return {
    exported_at: new Date().toISOString(),
    note: "Everything Kestrel holds about this contact. Backup files made before a deletion may still contain a deleted contact until they are replaced by newer ones.",
    contact: fields,
    client: client || null,
    projects, invoices, deals, drafts, activities, tasks, meetings,
    do_not_contact_entry: suppressed[0] || null,
  };
}

/** Why a contact cannot be deleted right now, or null when it can. */
export async function deleteBlocker(brandId, leadId) {
  const client = one(await query("SELECT id FROM clients WHERE brand_id = ? AND lead_id = ?", [brandId, leadId]));
  if (!client) return null;
  const [{ n }] = await query("SELECT COUNT(*)::int AS n FROM projects WHERE brand_id = ? AND client_id = ?", [brandId, client.id]);
  return n > 0
    ? "This person is a client with projects or invoices. Those are financial records you may be required to keep, so Kestrel will not delete them. Export their data instead, or remove the records by hand when you are allowed to."
    : null;
}

/** What deleting would remove, for the confirmation page. */
export async function deleteSummary(brandId, leadId) {
  const count = async (table, col = "lead_id") => (await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE brand_id = ? AND ${col} = ?`, [brandId, leadId]))[0].n;
  return { drafts: await count("drafts"), activities: await count("activities"), tasks: await count("tasks"), meetings: await count("meetings"), deals: await count("deals") };
}

/**
 * Permanently delete a contact and everything that hangs off it. Returns { deleted: true } or { deleted: false, reason }.
 * The audit entry records who and when, never the person's details.
 */
export async function deleteContact({ brandId, leadId, userId = null, ip = "" }) {
  const lead = await getLead(brandId, leadId);
  if (!lead) return { deleted: false, reason: "That contact was not found." };
  const blocker = await deleteBlocker(brandId, leadId);
  if (blocker) return { deleted: false, reason: blocker };
  if (lead.contact_email) await addSuppression(brandId, lead.contact_email, "contact deleted");
  if (lead.place_id) {
    await query("INSERT INTO deleted_places (brand_id, place_id, deleted_at) VALUES (?,?,?) ON CONFLICT DO NOTHING", [brandId, lead.place_id, new Date().toISOString()]);
  }
  await query("DELETE FROM clients WHERE brand_id = ? AND lead_id = ? AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = clients.id)", [brandId, leadId]);
  await query("DELETE FROM leads WHERE brand_id = ? AND id = ?", [brandId, leadId]);
  await audit(brandId, userId, "contact_deleted", `contact ${leadId}`, ip);
  return { deleted: true };
}
