// Data access layer. Every query is scoped by brand_id so a second brand/tenant
// can be added later without touching discovery, mockup, or email logic.
import crypto from "node:crypto";
import { getDb } from "./db.js";

const now = () => new Date().toISOString();
const plain = (row) => (row ? { ...row } : null);
const plainAll = (rows) => rows.map((r) => ({ ...r }));

// ---------- leads ----------

/** Insert a place, or refresh last_seen on a re-run. Dedupes on (brand_id, place_id). */
export function upsertPlace(brandId, place, searchLabel = "") {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM leads WHERE brand_id = ? AND place_id = ?")
    .get(brandId, place.place_id);
  const t = now();
  if (existing) {
    // Refresh Google-sourced facts; never touch user-entered fields (email, notes, status).
    db.prepare(
      `UPDATE leads SET name=?, category=?, category_label=?, address=?, city=?, region=?, phone=?,
         website=?, website_kind=?, maps_url=?, bucket=?, last_seen_at=? WHERE id=?`,
    ).run(
      place.name, place.category, place.category_label, place.address, place.city, place.region,
      place.phone, place.website, place.website_kind, place.maps_url, place.bucket, t, existing.id,
    );
    return { created: false, id: existing.id };
  }
  const token = crypto.randomBytes(16).toString("hex");
  const info = db
    .prepare(
      `INSERT INTO leads (brand_id, place_id, name, category, category_label, address, city, region,
         phone, website, website_kind, maps_url, bucket, mockup_token, search_label, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      brandId, place.place_id, place.name, place.category, place.category_label, place.address,
      place.city, place.region, place.phone, place.website, place.website_kind, place.maps_url,
      place.bucket, token, searchLabel, t, t,
    );
  return { created: true, id: Number(info.lastInsertRowid) };
}

export function listLeads(brandId, { bucket, q, status } = {}) {
  const where = ["l.brand_id = ?"];
  const args = [brandId];
  if (bucket) { where.push("l.bucket = ?"); args.push(bucket); }
  if (status) { where.push("l.status = ?"); args.push(status); }
  if (q) {
    where.push("(l.name LIKE ? OR l.city LIKE ? OR l.category_label LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  return plainAll(
    getDb()
      .prepare(
        `SELECT l.*, d.status AS draft_status FROM leads l
         LEFT JOIN drafts d ON d.lead_id = l.id
         WHERE ${where.join(" AND ")} ORDER BY l.first_seen_at DESC, l.id DESC LIMIT 500`,
      )
      .all(...args),
  );
}

export function getLead(brandId, id) {
  return plain(getDb().prepare("SELECT * FROM leads WHERE brand_id = ? AND id = ?").get(brandId, id));
}

/** Public lookup used by the hosted mockup page. Token is 128 random bits. */
export function getLeadByToken(token) {
  if (!/^[a-f0-9]{32}$/.test(token || "")) return null;
  return plain(getDb().prepare("SELECT * FROM leads WHERE mockup_token = ?").get(token));
}

export function updateLeadContact(brandId, id, { contact_email, notes, status }) {
  getDb()
    .prepare("UPDATE leads SET contact_email = ?, notes = ?, status = ? WHERE brand_id = ? AND id = ?")
    .run(contact_email || null, notes || null, status, brandId, id);
}

export function setLeadStatus(brandId, id, status) {
  getDb().prepare("UPDATE leads SET status = ? WHERE brand_id = ? AND id = ?").run(status, brandId, id);
}

export function stats(brandId) {
  const db = getDb();
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    noWebsite: count("SELECT COUNT(*) n FROM leads WHERE brand_id=? AND bucket='no_website'", brandId),
    hasWebsite: count("SELECT COUNT(*) n FROM leads WHERE brand_id=? AND bucket='has_website'", brandId),
    awaitingReview: count("SELECT COUNT(*) n FROM drafts WHERE brand_id=? AND status='draft'", brandId),
    approved: count("SELECT COUNT(*) n FROM drafts WHERE brand_id=? AND status='approved'", brandId),
    sent: count("SELECT COUNT(*) n FROM drafts WHERE brand_id=? AND status='sent'", brandId),
    optOuts: count("SELECT COUNT(*) n FROM suppressions WHERE brand_id=?", brandId),
  };
}

// ---------- searches ----------

export function recordSearch(brandId, { query, results = 0, new_leads = 0, error = null }) {
  getDb()
    .prepare("INSERT INTO searches (brand_id, query, results, new_leads, error, created_at) VALUES (?,?,?,?,?,?)")
    .run(brandId, query, results, new_leads, error, now());
}

export function listSearches(brandId, limit = 15) {
  return plainAll(
    getDb().prepare("SELECT * FROM searches WHERE brand_id = ? ORDER BY id DESC LIMIT ?").all(brandId, limit),
  );
}

// ---------- drafts ----------

export function getDraftByLead(brandId, leadId) {
  return plain(getDb().prepare("SELECT * FROM drafts WHERE brand_id = ? AND lead_id = ?").get(brandId, leadId));
}

export function saveDraft(brandId, leadId, { subject, body }) {
  const db = getDb();
  const existing = getDraftByLead(brandId, leadId);
  if (existing) {
    if (existing.status === "sent") throw new Error("This draft was already sent and cannot be edited.");
    // Any edit sends the draft back to review.
    db.prepare("UPDATE drafts SET subject=?, body=?, status='draft', approved_at=NULL WHERE id=?").run(
      subject, body, existing.id,
    );
    return existing.id;
  }
  const info = db
    .prepare("INSERT INTO drafts (brand_id, lead_id, subject, body, created_at) VALUES (?,?,?,?,?)")
    .run(brandId, leadId, subject, body, now());
  return Number(info.lastInsertRowid);
}

export function setDraftStatus(brandId, leadId, status) {
  const approvedAt = status === "approved" ? now() : null;
  getDb()
    .prepare("UPDATE drafts SET status = ?, approved_at = ? WHERE brand_id = ? AND lead_id = ? AND status != 'sent'")
    .run(status, approvedAt, brandId, leadId);
}

export function markDraftSent(brandId, leadId, { to, resendId }) {
  getDb()
    .prepare("UPDATE drafts SET status='sent', sent_at=?, sent_to=?, resend_id=?, send_error=NULL WHERE brand_id=? AND lead_id=?")
    .run(now(), to, resendId || null, brandId, leadId);
  getDb().prepare("UPDATE leads SET status='contacted' WHERE brand_id=? AND id=? AND status='new'").run(brandId, leadId);
}

export function markDraftSendError(brandId, leadId, message) {
  getDb().prepare("UPDATE drafts SET send_error=? WHERE brand_id=? AND lead_id=?").run(message.slice(0, 500), brandId, leadId);
}

export function listDrafts(brandId, status) {
  const args = [brandId];
  let where = "d.brand_id = ?";
  if (status) { where += " AND d.status = ?"; args.push(status); }
  return plainAll(
    getDb()
      .prepare(
        `SELECT d.*, l.name AS lead_name, l.city AS lead_city, l.contact_email AS lead_email
         FROM drafts d JOIN leads l ON l.id = d.lead_id
         WHERE ${where} ORDER BY d.created_at DESC LIMIT 500`,
      )
      .all(...args),
  );
}

export function countSentToday(brandId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return getDb()
    .prepare("SELECT COUNT(*) n FROM drafts WHERE brand_id = ? AND status='sent' AND sent_at >= ?")
    .get(brandId, start.toISOString()).n;
}

/** Leads in the no-website bucket that have no draft yet. */
export function leadsNeedingDraft(brandId) {
  return plainAll(
    getDb()
      .prepare(
        `SELECT l.* FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id
         WHERE l.brand_id = ? AND l.bucket = 'no_website' AND d.id IS NULL
           AND l.status NOT IN ('do_not_contact','skipped')`,
      )
      .all(brandId),
  );
}

// ---------- suppressions (opt-outs) ----------

export const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

export function addSuppression(brandId, email, reason = "unsubscribe") {
  const e = normalizeEmail(email);
  if (!e) return;
  getDb()
    .prepare("INSERT OR IGNORE INTO suppressions (brand_id, email, reason, created_at) VALUES (?,?,?,?)")
    .run(brandId, e, reason, now());
  // Any lead using this address becomes do_not_contact; pending drafts are rejected.
  const leads = getDb()
    .prepare("SELECT id FROM leads WHERE brand_id = ? AND lower(contact_email) = ?")
    .all(brandId, e);
  for (const l of leads) {
    setLeadStatus(brandId, l.id, "do_not_contact");
    setDraftStatus(brandId, l.id, "rejected");
  }
}

export function isSuppressed(brandId, email) {
  return !!getDb()
    .prepare("SELECT 1 FROM suppressions WHERE brand_id = ? AND email = ?")
    .get(brandId, normalizeEmail(email));
}

export function listSuppressions(brandId) {
  return plainAll(
    getDb().prepare("SELECT * FROM suppressions WHERE brand_id = ? ORDER BY created_at DESC").all(brandId),
  );
}
