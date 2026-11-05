// Data access layer (Postgres). Every query is scoped by brand_id so a second
// brand/tenant can be added later without touching discovery, mockup, or email logic.
import crypto from "node:crypto";
import { query } from "./db.js";

const now = () => new Date().toISOString();
const one = (rows) => rows[0] || null;

// ---------- leads ----------

/** Insert a place, or refresh last_seen on a re-run. Dedupes on (brand_id, place_id). */
export async function upsertPlace(brandId, place, searchLabel = "") {
  const existing = one(await query("SELECT id FROM leads WHERE brand_id = ? AND place_id = ?", [brandId, place.place_id]));
  const t = now();
  if (existing) {
    // Refresh Google-sourced facts; never touch user-entered fields (email, notes, status).
    await query(
      `UPDATE leads SET name=?, category=?, category_label=?, address=?, city=?, region=?, phone=?,
         website=?, website_kind=?, maps_url=?, bucket=?, last_seen_at=? WHERE id=?`,
      [place.name, place.category, place.category_label, place.address, place.city, place.region,
        place.phone, place.website, place.website_kind, place.maps_url, place.bucket, t, existing.id],
    );
    return { created: false, id: existing.id };
  }
  const token = crypto.randomBytes(16).toString("hex");
  const rows = await query(
    `INSERT INTO leads (brand_id, place_id, name, category, category_label, address, city, region,
       phone, website, website_kind, maps_url, bucket, mockup_token, search_label, first_seen_at, last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (brand_id, place_id) DO NOTHING RETURNING id`,
    [brandId, place.place_id, place.name, place.category, place.category_label, place.address,
      place.city, place.region, place.phone, place.website, place.website_kind, place.maps_url,
      place.bucket, token, searchLabel, t, t],
  );
  return rows.length ? { created: true, id: rows[0].id } : { created: false, id: null };
}

export async function listLeads(brandId, { bucket, q, status } = {}) {
  const where = ["l.brand_id = ?"];
  const args = [brandId];
  if (bucket) { where.push("l.bucket = ?"); args.push(bucket); }
  if (status) { where.push("l.status = ?"); args.push(status); }
  if (q) {
    where.push("(l.name ILIKE ? OR l.city ILIKE ? OR l.category_label ILIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  return query(
    `SELECT l.*, d.status AS draft_status FROM leads l
     LEFT JOIN drafts d ON d.lead_id = l.id
     WHERE ${where.join(" AND ")} ORDER BY l.first_seen_at DESC, l.id DESC LIMIT 500`,
    args,
  );
}

export async function getLead(brandId, id) {
  return one(await query("SELECT * FROM leads WHERE brand_id = ? AND id = ?", [brandId, id]));
}

/** Public lookup used by the hosted mockup page. Token is 128 random bits. */
export async function getLeadByToken(token) {
  if (!/^[a-f0-9]{32}$/.test(token || "")) return null;
  return one(await query("SELECT * FROM leads WHERE mockup_token = ?", [token]));
}

export async function updateLeadContact(brandId, id, { contact_email, notes, status }) {
  await query("UPDATE leads SET contact_email = ?, notes = ?, status = ? WHERE brand_id = ? AND id = ?",
    [contact_email || null, notes || null, status, brandId, id]);
}

export async function setLeadStatus(brandId, id, status) {
  await query("UPDATE leads SET status = ? WHERE brand_id = ? AND id = ?", [status, brandId, id]);
}

export async function stats(brandId) {
  const count = async (sql) => one(await query(`SELECT COUNT(*)::int AS n ${sql}`, [brandId])).n;
  const [noWebsite, hasWebsite, awaitingReview, approved, sent, optOuts] = await Promise.all([
    count("FROM leads WHERE brand_id=? AND bucket='no_website'"),
    count("FROM leads WHERE brand_id=? AND bucket='has_website'"),
    count("FROM drafts WHERE brand_id=? AND status='draft'"),
    count("FROM drafts WHERE brand_id=? AND status='approved'"),
    count("FROM drafts WHERE brand_id=? AND status='sent'"),
    count("FROM suppressions WHERE brand_id=?"),
  ]);
  return { noWebsite, hasWebsite, awaitingReview, approved, sent, optOuts };
}

// ---------- searches ----------

export async function recordSearch(brandId, { query: q, results = 0, new_leads = 0, error = null }) {
  await query("INSERT INTO searches (brand_id, query, results, new_leads, error, created_at) VALUES (?,?,?,?,?,?)",
    [brandId, q, results, new_leads, error, now()]);
}

export async function listSearches(brandId, limit = 15) {
  return query("SELECT * FROM searches WHERE brand_id = ? ORDER BY id DESC LIMIT ?", [brandId, limit]);
}

// ---------- drafts ----------

export async function getDraftByLead(brandId, leadId) {
  return one(await query("SELECT * FROM drafts WHERE brand_id = ? AND lead_id = ?", [brandId, leadId]));
}

export async function saveDraft(brandId, leadId, { subject, body }) {
  const existing = await getDraftByLead(brandId, leadId);
  if (existing) {
    if (existing.status === "sent") throw new Error("This draft was already sent and cannot be edited.");
    // Any edit sends the draft back to review.
    await query("UPDATE drafts SET subject=?, body=?, status='draft', approved_at=NULL WHERE id=?", [subject, body, existing.id]);
    return existing.id;
  }
  const rows = await query(
    "INSERT INTO drafts (brand_id, lead_id, subject, body, created_at) VALUES (?,?,?,?,?) RETURNING id",
    [brandId, leadId, subject, body, now()],
  );
  return rows[0].id;
}

export async function setDraftStatus(brandId, leadId, status) {
  const approvedAt = status === "approved" ? now() : null;
  await query("UPDATE drafts SET status = ?, approved_at = ? WHERE brand_id = ? AND lead_id = ? AND status != 'sent'",
    [status, approvedAt, brandId, leadId]);
}

export async function markDraftSent(brandId, leadId, { to, resendId }) {
  await query("UPDATE drafts SET status='sent', sent_at=?, sent_to=?, resend_id=?, send_error=NULL WHERE brand_id=? AND lead_id=?",
    [now(), to, resendId || null, brandId, leadId]);
  await query("UPDATE leads SET status='contacted' WHERE brand_id=? AND id=? AND status='new'", [brandId, leadId]);
}

export async function markDraftSendError(brandId, leadId, message) {
  await query("UPDATE drafts SET send_error=? WHERE brand_id=? AND lead_id=?", [message.slice(0, 500), brandId, leadId]);
}

export async function listDrafts(brandId, status) {
  const args = [brandId];
  let where = "d.brand_id = ?";
  if (status) { where += " AND d.status = ?"; args.push(status); }
  return query(
    `SELECT d.*, l.name AS lead_name, l.city AS lead_city, l.contact_email AS lead_email
     FROM drafts d JOIN leads l ON l.id = d.lead_id
     WHERE ${where} ORDER BY d.created_at DESC LIMIT 500`,
    args,
  );
}

export async function countSentToday(brandId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return one(await query("SELECT COUNT(*)::int AS n FROM drafts WHERE brand_id = ? AND status='sent' AND sent_at >= ?",
    [brandId, start.toISOString()])).n;
}

/** Leads in the no-website bucket that have no draft yet. */
export async function leadsNeedingDraft(brandId) {
  return query(
    `SELECT l.* FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id
     WHERE l.brand_id = ? AND l.bucket = 'no_website' AND d.id IS NULL
       AND l.status NOT IN ('do_not_contact','skipped')`,
    [brandId],
  );
}

// ---------- suppressions (opt-outs) ----------

export const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

export async function addSuppression(brandId, email, reason = "unsubscribe") {
  const e = normalizeEmail(email);
  if (!e) return;
  await query("INSERT INTO suppressions (brand_id, email, reason, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
    [brandId, e, reason, now()]);
  // Any lead using this address becomes do_not_contact; pending drafts are rejected.
  const leads = await query("SELECT id FROM leads WHERE brand_id = ? AND lower(contact_email) = ?", [brandId, e]);
  for (const l of leads) {
    await setLeadStatus(brandId, l.id, "do_not_contact");
    await setDraftStatus(brandId, l.id, "rejected");
  }
}

export async function isSuppressed(brandId, email) {
  return (await query("SELECT 1 AS x FROM suppressions WHERE brand_id = ? AND email = ?", [brandId, normalizeEmail(email)])).length > 0;
}

export async function listSuppressions(brandId) {
  return query("SELECT * FROM suppressions WHERE brand_id = ? ORDER BY created_at DESC", [brandId]);
}
