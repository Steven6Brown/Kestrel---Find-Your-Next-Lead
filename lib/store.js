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
         website=?, website_kind=?, maps_url=?, bucket = CASE WHEN site_check = 'unchecked' THEN ? ELSE bucket END, last_seen_at=? WHERE id=?`,
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

/**
 * Human check of whether a business really has no website.
 * confirmed_none keeps it in the no-website bucket; has_site moves it to has-website.
 */
export async function setSiteCheck(brandId, id, verdict) {
  const bucket = verdict === "has_site" ? "has_website" : "no_website";
  await query("UPDATE leads SET site_check = ?, bucket = ? WHERE brand_id = ? AND id = ?", [verdict, bucket, brandId, id]);
}

/** OpenStreetMap leads must be human-checked before outreach; Google listings count as checked. */
export const outreachReady = (lead) => !String(lead.place_id || "").startsWith("osm:") || lead.site_check === "confirmed_none";

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
  await query("UPDATE leads SET stage='contacted' WHERE brand_id=? AND id=? AND stage='new'", [brandId, leadId]);
  await addActivity(brandId, leadId, { kind: "email_out", body: "Outreach email sent to " + to, metadata: { resendId: resendId || null } });
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
       AND l.status NOT IN ('do_not_contact','skipped')
       AND (COALESCE(l.place_id, '') NOT LIKE 'osm:%' OR l.site_check = 'confirmed_none')`,
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
    await query("UPDATE leads SET stage='not_interested' WHERE brand_id=? AND id=? AND stage <> 'not_interested'", [brandId, l.id]);
    await addActivity(brandId, l.id, { kind: "system", body: "Opted out of email (" + reason + ")" });
  }
}

export async function isSuppressed(brandId, email) {
  return (await query("SELECT 1 AS x FROM suppressions WHERE brand_id = ? AND email = ?", [brandId, normalizeEmail(email)])).length > 0;
}

export async function listSuppressions(brandId) {
  return query("SELECT * FROM suppressions WHERE brand_id = ? ORDER BY created_at DESC", [brandId]);
}

// ---------- campaigns ----------

const parseCampaign = (r) => (r ? { ...r, categories: JSON.parse(r.categories), locations: JSON.parse(r.locations) } : null);

export async function createCampaign(brandId, { name, categories, locations, frequency, run_time }) {
  const rows = await query(
    `INSERT INTO campaigns (brand_id, name, categories, locations, frequency, run_time, created_at)
     VALUES (?,?,?,?,?,?,?) RETURNING id`,
    [brandId, name, JSON.stringify(categories), JSON.stringify(locations), frequency, run_time, now()],
  );
  return rows[0].id;
}

export async function listCampaigns(brandId) {
  return (await query("SELECT * FROM campaigns WHERE brand_id = ? ORDER BY id DESC", [brandId])).map(parseCampaign);
}

export async function getCampaign(brandId, id) {
  return parseCampaign(one(await query("SELECT * FROM campaigns WHERE brand_id = ? AND id = ?", [brandId, id])));
}

export async function setCampaignEnabled(brandId, id, enabled) {
  await query("UPDATE campaigns SET enabled = ? WHERE brand_id = ? AND id = ?", [enabled, brandId, id]);
}

export async function deleteCampaign(brandId, id) {
  await query("DELETE FROM area_scans WHERE campaign_id = ?", [id]);
  await query("DELETE FROM campaigns WHERE brand_id = ? AND id = ?", [brandId, id]);
}

// ---------- area scan memory (lets a scan stop and continue later) ----------

export async function freshAreaScans(campaignId, sinceIso) {
  const rows = await query("SELECT location, family FROM area_scans WHERE campaign_id = ? AND scanned_at > ?", [campaignId, sinceIso]);
  return new Set(rows.map((r) => r.location + "|" + r.family));
}

export async function markAreaScan(campaignId, location, family, results) {
  await query(
    "INSERT INTO area_scans (campaign_id, location, family, scanned_at, results) VALUES (?,?,?,?,?) " +
      "ON CONFLICT (campaign_id, location, family) DO UPDATE SET scanned_at = EXCLUDED.scanned_at, results = EXCLUDED.results",
    [campaignId, location, family, now(), results],
  );
}

// ---------- runs (history of every scan, scheduled or manual) ----------

/** Runs left "running" by a restart or crash are closed out so they never block new ones. */
export async function expireStaleRuns(brandId, maxAgeMs = 2 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  await query("UPDATE runs SET status='interrupted', finished_at=? WHERE brand_id=? AND status='running' AND started_at < ?", [now(), brandId, cutoff]);
}

export async function runningRun(brandId, campaignId) {
  return one(await query("SELECT * FROM runs WHERE brand_id=? AND campaign_id=? AND status='running'", [brandId, campaignId]));
}

export async function createRun(brandId, { campaignId, campaignName, trigger }) {
  const rows = await query(
    "INSERT INTO runs (brand_id, campaign_id, campaign_name, trigger, started_at) VALUES (?,?,?,?,?) RETURNING id",
    [brandId, campaignId, campaignName, trigger, now()],
  );
  return rows[0].id;
}

export async function finishRun(runId, { status, searches = 0, found = 0, created = 0, noWebsite = 0, hasWebsite = 0, error = null }) {
  await query(
    `UPDATE runs SET status=?, finished_at=?, searches=?, found=?, created=?, no_website=?, has_website=?, error=? WHERE id=?`,
    [status, now(), searches, found, created, noWebsite, hasWebsite, error ? String(error).slice(0, 500) : null, runId],
  );
}

/** Live counters so a long scan shows movement instead of silence. */
export async function updateRunProgress(runId, p) {
  await query(
    "UPDATE runs SET total_searches=?, searches=?, found=?, created=?, no_website=?, has_website=? WHERE id=?",
    [p.total || 0, p.attempted || 0, p.found || 0, p.created || 0, p.noWebsite || 0, p.hasWebsite || 0, runId],
  );
}

export async function touchCampaign(campaignId) {
  await query("UPDATE campaigns SET last_run_at = ? WHERE id = ?", [now(), campaignId]);
}

export async function listRuns(brandId, { campaignId, limit = 12 } = {}) {
  const args = [brandId];
  let where = "brand_id = ?";
  if (campaignId) { where += " AND campaign_id = ?"; args.push(campaignId); }
  args.push(limit);
  return query(`SELECT * FROM runs WHERE ${where} ORDER BY id DESC LIMIT ?`, args);
}

// ---------- the leads database: filtering, facets, export ----------

import { buildWhere, PAGE_SIZE } from "./leadfilters.js";

export async function searchLeads(brandId, f, { limit = PAGE_SIZE, offset = 0 } = {}) {
  const { where, args } = buildWhere(brandId, f);
  return query(
    `SELECT l.*, d.status AS draft_status FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id
     WHERE ${where} ORDER BY l.name ASC, l.id ASC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
}

export async function countLeadsFiltered(brandId, f) {
  const { where, args } = buildWhere(brandId, f);
  return one(await query(`SELECT COUNT(*)::int AS n FROM leads l WHERE ${where}`, args)).n;
}

/** Counts for the category and city chips, each computed with every other filter applied. */
export async function leadFacets(brandId, f) {
  const cat = buildWhere(brandId, f, "category");
  const city = buildWhere(brandId, f, "city");
  const [categories, cities] = await Promise.all([
    query(
      `SELECT l.category AS value, MAX(l.category_label) AS label, COUNT(*)::int AS n FROM leads l
       WHERE ${cat.where} AND COALESCE(l.category, '') <> '' GROUP BY l.category ORDER BY n DESC, l.category LIMIT 30`,
      cat.args,
    ),
    query(
      `SELECT l.city AS value, COUNT(*)::int AS n FROM leads l
       WHERE ${city.where} AND COALESCE(l.city, '') <> '' GROUP BY l.city ORDER BY n DESC, l.city LIMIT 30`,
      city.args,
    ),
  ]);
  return { categories, cities };
}

export async function leadsForExport(brandId, f, limit = 5000) {
  return searchLeads(brandId, f, { limit, offset: 0 });
}

/** Leads in the current filter that are ready for outreach and have no draft yet. */
export async function draftableInFilter(brandId, f, limit = 200) {
  const { where, args } = buildWhere(brandId, { ...f, ready: "1" });
  return query(
    `SELECT l.* FROM leads l LEFT JOIN drafts d ON d.lead_id = l.id WHERE ${where} AND d.id IS NULL ORDER BY l.name LIMIT ?`,
    [...args, limit],
  );
}

// ---------- CRM: contacts, timeline, tasks ----------

import { STAGE_KEYS, ACTIVITY_KINDS, isDateStr, sourceLabel, stageLabel, statusForStage } from "./crm.js";

const OPEN = "done_at IS NULL";
const IN_PIPELINE = "(l.stage <> 'new' OR l.source <> 'kestrel' OR EXISTS (SELECT 1 FROM drafts dr WHERE dr.lead_id = l.id))";

/** A contact added by hand (referral, seminar, manual). Reuses the leads table. */
export async function createContact(brandId, { name, email = "", phone = "", source = "manual", notes = "", userId = null }) {
  const rows = await query(
    `INSERT INTO leads (brand_id, place_id, name, bucket, mockup_token, contact_email, phone, source, owner_notes, status, stage, first_seen_at, last_seen_at)
     VALUES (?, NULL, ?, 'unknown', ?, ?, ?, ?, ?, 'new', 'new', ?, ?) RETURNING id`,
    [brandId, name, crypto.randomBytes(16).toString("hex"), email || null, phone || "", source, notes || null, now(), now()],
  );
  const id = rows[0].id;
  await addActivity(brandId, id, { kind: "system", body: "Contact added (" + sourceLabel(source) + ")", userId });
  return id;
}

export async function addActivity(brandId, leadId, { kind = "note", body = "", userId = null, metadata = {} }) {
  if (!ACTIVITY_KINDS.includes(kind)) throw new Error("Unknown activity kind.");
  await query(
    "INSERT INTO activities (brand_id, lead_id, kind, body, user_id, metadata, created_at) VALUES (?,?,?,?,?,?,?)",
    [brandId, leadId, kind, String(body).slice(0, 4000), userId, JSON.stringify(metadata), now()],
  );
}

/** Newest first. Append-only: there is deliberately no edit or delete. */
export async function listActivities(brandId, leadId, limit = 100) {
  return query(
    `SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.brand_id = ? AND a.lead_id = ? ORDER BY a.id DESC LIMIT ?`,
    [brandId, leadId, limit],
  );
}

/** Moves a contact to a stage, keeps the older status field in step, and writes the timeline. */
export async function setStage(brandId, leadId, stage, { userId = null } = {}) {
  if (!STAGE_KEYS.includes(stage)) throw new Error("Unknown stage.");
  const lead = await getLead(brandId, leadId);
  if (!lead) throw new Error("Contact not found.");
  if (lead.stage === stage) return { changed: false, lead };
  await query("UPDATE leads SET stage = ?, status = ? WHERE brand_id = ? AND id = ?", [stage, statusForStage(stage, lead.status), brandId, leadId]);
  await addActivity(brandId, leadId, { kind: "stage_change", body: stageLabel(lead.stage) + " to " + stageLabel(stage), userId, metadata: { from: lead.stage, to: stage } });
  if (stage === "not_interested") {
    // Not interested means do not contact: stop any pending outreach and suppress the address.
    await setDraftStatus(brandId, leadId, "rejected");
    if (lead.contact_email) await addSuppression(brandId, lead.contact_email, "marked not interested");
  }
  return { changed: true, lead: { ...lead, stage } };
}

export async function setOwnerNotes(brandId, leadId, notes) {
  await query("UPDATE leads SET owner_notes = ? WHERE brand_id = ? AND id = ?", [String(notes || "").slice(0, 4000) || null, brandId, leadId]);
}

export async function addTask(brandId, leadId, { title, dueOn, userId = null }) {
  if (!isDateStr(dueOn)) throw new Error("A due date is required.");
  const rows = await query(
    "INSERT INTO tasks (brand_id, lead_id, title, due_on, created_by, created_at) SELECT brand_id, id, ?, ?, ?, ? FROM leads WHERE brand_id = ? AND id = ? RETURNING id",
    [String(title).trim().slice(0, 200), dueOn, userId, now(), brandId, leadId],
  );
  if (!rows.length) throw new Error("Contact not found.");
  return rows[0].id;
}

export async function completeTask(brandId, taskId, { userId = null } = {}) {
  const rows = await query("UPDATE tasks SET done_at = ? WHERE brand_id = ? AND id = ? AND " + OPEN + " RETURNING lead_id, title", [now(), brandId, taskId]);
  if (rows.length) await addActivity(brandId, rows[0].lead_id, { kind: "system", body: "Task done: " + rows[0].title, userId });
  return rows.length > 0;
}

export async function tasksForLead(brandId, leadId) {
  return query("SELECT * FROM tasks WHERE brand_id = ? AND lead_id = ? ORDER BY (done_at IS NOT NULL), due_on ASC, id ASC", [brandId, leadId]);
}

/** Open tasks grouped for the Today screen. Days are plain YYYY-MM-DD strings, compared as text. */
export async function dueTasks(brandId, today, upcomingDays = 7, addDaysFn) {
  const rows = await query(
    `SELECT t.*, l.name AS lead_name, l.stage AS lead_stage FROM tasks t JOIN leads l ON l.id = t.lead_id
     WHERE t.brand_id = ? AND t.done_at IS NULL ORDER BY t.due_on ASC, t.id ASC LIMIT 500`,
    [brandId],
  );
  const end = addDaysFn(today, upcomingDays);
  return {
    overdue: rows.filter((t) => t.due_on < today),
    today: rows.filter((t) => t.due_on === today),
    upcoming: rows.filter((t) => t.due_on > today && t.due_on <= end),
  };
}

export async function stageCounts(brandId) {
  const rows = await query("SELECT l.stage, COUNT(*)::int AS n FROM leads l WHERE l.brand_id = ? AND " + IN_PIPELINE + " GROUP BY l.stage", [brandId]);
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

/** Contacts in a stage, most recently touched first. Used by the pipeline board. */
export async function leadsByStage(brandId, stage, limit = 25) {
  return query(
    `SELECT l.id, l.name, l.city, l.phone, l.source, l.contact_email,
            (SELECT MAX(a.created_at) FROM activities a WHERE a.lead_id = l.id) AS last_activity,
            (SELECT MIN(t.due_on) FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL) AS next_due
     FROM leads l WHERE l.brand_id = ? AND l.stage = ? AND ${IN_PIPELINE} ORDER BY last_activity DESC NULLS LAST, l.id DESC LIMIT ?`,
    [brandId, stage, limit],
  );
}

export async function setTaskDue(brandId, taskId, dueOn) {
  if (!isDateStr(dueOn)) throw new Error("A due date is required.");
  await query("UPDATE tasks SET due_on = ? WHERE brand_id = ? AND id = ? AND " + OPEN, [dueOn, brandId, taskId]);
}

export async function findLeadByEmail(brandId, email) {
  return one(await query("SELECT id FROM leads WHERE brand_id = ? AND lower(contact_email) = ?", [brandId, String(email).trim().toLowerCase()]));
}

/** People mid-conversation who have no open follow-up, so nothing reminds you to chase them. */
export async function needsFollowUp(brandId, limit = 50) {
  return query(
    `SELECT l.id, l.name, l.stage,
            (SELECT MAX(a.created_at) FROM activities a WHERE a.lead_id = l.id) AS last_activity
     FROM leads l
     WHERE l.brand_id = ? AND l.stage IN ('contacted','replied','meeting_booked','proposal_sent')
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL)
     ORDER BY last_activity ASC NULLS FIRST LIMIT ?`,
    [brandId, limit],
  );
}

// ---------- clients, projects, meetings ----------

const clientRow = async (brandId, id) => one(await query("SELECT * FROM clients WHERE brand_id = ? AND id = ?", [brandId, id]));
export const getClient = clientRow;

export async function getClientByLead(brandId, leadId) {
  return one(await query("SELECT * FROM clients WHERE brand_id = ? AND lead_id = ?", [brandId, leadId]));
}

/** A client who never came through the scanner (existing clients, referrals you already work with). */
export async function createClient(brandId, { name, email = "", phone = "", notes = "" }) {
  const rows = await query(
    "INSERT INTO clients (brand_id, lead_id, name, email, phone, notes, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?) RETURNING id",
    [brandId, name, email || null, phone || null, notes || null, now()],
  );
  return rows[0].id;
}

/** Turns a contact into a client (once) and marks the contact won. */
export async function convertToClient(brandId, leadId, { userId = null } = {}) {
  const lead = await getLead(brandId, leadId);
  if (!lead) throw new Error("Contact not found.");
  const existing = await getClientByLead(brandId, leadId);
  if (existing) return { id: existing.id, created: false };
  const rows = await query(
    "INSERT INTO clients (brand_id, lead_id, name, email, phone, created_at) VALUES (?,?,?,?,?,?) RETURNING id",
    [brandId, leadId, lead.name, lead.contact_email || null, lead.phone || null, now()],
  );
  await setStage(brandId, leadId, "won", { userId });
  await addActivity(brandId, leadId, { kind: "system", body: "Converted to a client", userId });
  return { id: rows[0].id, created: true };
}

export async function listClients(brandId) {
  return query(
    `SELECT c.*, COUNT(p.id)::int AS project_count, COALESCE(SUM(p.quoted_amount_cents), 0)::bigint AS quoted_total
     FROM clients c LEFT JOIN projects p ON p.client_id = c.id AND p.status <> 'cancelled'
     WHERE c.brand_id = ? GROUP BY c.id ORDER BY c.created_at DESC`,
    [brandId],
  );
}

export async function setClientStatus(brandId, id, status) {
  await query("UPDATE clients SET status = ? WHERE brand_id = ? AND id = ?", [status, brandId, id]);
}

export async function setClientNotes(brandId, id, notes) {
  await query("UPDATE clients SET notes = ? WHERE brand_id = ? AND id = ?", [String(notes || "").slice(0, 4000) || null, brandId, id]);
}

export async function createProject(brandId, clientId, { name, type, status, quotedCents = null, startOn = null, targetOn = null, notes = "" }) {
  const rows = await query(
    `INSERT INTO projects (brand_id, client_id, name, type, status, quoted_amount_cents, start_on, target_on, notes, created_at, updated_at)
     SELECT brand_id, id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM clients WHERE brand_id = ? AND id = ? RETURNING id`,
    [name, type, status, quotedCents, startOn, targetOn, notes || null, now(), now(), brandId, clientId],
  );
  if (!rows.length) throw new Error("Client not found.");
  return rows[0].id;
}

export async function listProjects(brandId, { clientId } = {}) {
  const args = [brandId];
  let where = "p.brand_id = ?";
  if (clientId) { where += " AND p.client_id = ?"; args.push(clientId); }
  return query(
    `SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE ${where} ORDER BY p.created_at DESC LIMIT 500`,
    args,
  );
}

export async function setProjectStatus(brandId, projectId, status) {
  await query("UPDATE projects SET status = ?, updated_at = ? WHERE brand_id = ? AND id = ?", [status, now(), brandId, projectId]);
}

/** Meetings you log by hand. Attached to a contact or a client, never both. */
export async function createMeeting(brandId, { leadId = null, clientId = null, title, location, startsAt, notes = "", userId = null }) {
  if (!leadId === !clientId) throw new Error("A meeting belongs to a contact or a client.");
  const rows = leadId
    ? await query(
        `INSERT INTO meetings (brand_id, lead_id, client_id, title, location, starts_at, notes, created_at)
         SELECT brand_id, id, NULL, ?, ?, ?, ?, ? FROM leads WHERE brand_id = ? AND id = ? RETURNING id`,
        [title, location, startsAt, notes || null, now(), brandId, leadId],
      )
    : await query(
        `INSERT INTO meetings (brand_id, lead_id, client_id, title, location, starts_at, notes, created_at)
         SELECT brand_id, NULL, id, ?, ?, ?, ?, ? FROM clients WHERE brand_id = ? AND id = ? RETURNING id`,
        [title, location, startsAt, notes || null, now(), brandId, clientId],
      );
  if (!rows.length) throw new Error("Contact or client not found.");
  if (leadId) {
    const lead = await getLead(brandId, leadId);
    if (["new", "contacted", "replied"].includes(lead.stage)) await setStage(brandId, leadId, "meeting_booked", { userId });
    await addActivity(brandId, leadId, { kind: "meeting", body: title + " scheduled for " + new Date(startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), userId, metadata: { meetingId: rows[0].id, location } });
  }
  return rows[0].id;
}

export async function listMeetings(brandId, { fromIso, toIso, limit = 100, order = "ASC" } = {}) {
  const args = [brandId];
  let where = "m.brand_id = ?";
  if (fromIso) { where += " AND m.starts_at >= ?"; args.push(fromIso); }
  if (toIso) { where += " AND m.starts_at < ?"; args.push(toIso); }
  args.push(limit);
  return query(
    `SELECT m.*, l.name AS lead_name, c.name AS client_name FROM meetings m
     LEFT JOIN leads l ON l.id = m.lead_id LEFT JOIN clients c ON c.id = m.client_id
     WHERE ${where} ORDER BY m.starts_at ${order === "DESC" ? "DESC" : "ASC"} LIMIT ?`,
    args,
  );
}

export async function setMeetingStatus(brandId, id, status) {
  const rows = await query("UPDATE meetings SET status = ? WHERE brand_id = ? AND id = ? RETURNING lead_id, title", [status, brandId, id]);
  if (rows[0]?.lead_id) await addActivity(brandId, rows[0].lead_id, { kind: "meeting", body: rows[0].title + " marked " + status });
}

// ---------- exports ----------

export async function contactsForExport(brandId) {
  return query(
    `SELECT l.name, l.contact_email, l.phone, l.city, l.region, l.source, l.stage, l.website, l.first_seen_at
     FROM leads l WHERE l.brand_id = ? AND ${IN_PIPELINE} ORDER BY l.name LIMIT 20000`,
    [brandId],
  );
}

// ---------- connections (outside services) ----------

import { decrypt, encrypt } from "./crypto.js";

export async function getConnection(brandId, provider) {
  return one(await query("SELECT * FROM connections WHERE brand_id = ? AND provider = ?", [brandId, provider]));
}

export async function listConnections(brandId) {
  return query("SELECT * FROM connections WHERE brand_id = ?", [brandId]);
}

/**
 * Create or update a connection. `config` is non-secret settings. `secret` (tokens, keys) is
 * encrypted at rest and is never returned by list or get; use readConnectionSecret to open it.
 */
export async function saveConnection(brandId, provider, { status = "connected", config = {}, secret = null, scopes = "", error = null }) {
  const secretEnc = secret == null ? null : encrypt(JSON.stringify(secret));
  await query(
    `INSERT INTO connections (brand_id, provider, status, config, secret_enc, scopes, connected_at, last_checked_at, last_error)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (brand_id, provider) DO UPDATE SET status = EXCLUDED.status, config = EXCLUDED.config,
       secret_enc = COALESCE(EXCLUDED.secret_enc, connections.secret_enc), scopes = EXCLUDED.scopes,
       connected_at = COALESCE(connections.connected_at, EXCLUDED.connected_at),
       last_checked_at = EXCLUDED.last_checked_at, last_error = EXCLUDED.last_error`,
    [brandId, provider, status, JSON.stringify(config), secretEnc, scopes, now(), now(), error ? String(error).slice(0, 300) : null],
  );
}

export function readConnectionSecret(connection) {
  return connection?.secret_enc ? JSON.parse(decrypt(connection.secret_enc)) : null;
}

/** Record the outcome of a health check without changing anything else about the connection. */
export async function recordConnectionCheck(brandId, provider, { ok, message = "" }) {
  const status = ok ? "connected" : "error";
  await query(
    `INSERT INTO connections (brand_id, provider, status, config, connected_at, last_checked_at, last_error)
     VALUES (?,?,?,'{}',?,?,?)
     ON CONFLICT (brand_id, provider) DO UPDATE SET status = EXCLUDED.status, last_checked_at = EXCLUDED.last_checked_at,
       last_error = EXCLUDED.last_error, connected_at = COALESCE(connections.connected_at, EXCLUDED.connected_at)`,
    [brandId, provider, status, ok ? now() : null, now(), ok ? null : String(message).slice(0, 300)],
  );
}

/** Forget a connection: settings and any stored secret are erased. */
export async function disconnectConnection(brandId, provider) {
  await query(
    "UPDATE connections SET status = 'disconnected', config = '{}', secret_enc = NULL, scopes = '', last_error = NULL, last_checked_at = ? WHERE brand_id = ? AND provider = ?",
    [now(), brandId, provider],
  );
}

/** The saved booking link for a brand, or null. */
export async function getBookingUrl(brandId) {
  const c = await getConnection(brandId, "booking_link");
  if (!c || c.status !== "connected") return null;
  return JSON.parse(c.config || "{}").url || null;
}

// ---------- invoices ----------

import { BILLED_GROUPS, OWED_GROUPS, statusGroup } from "./invoicestatus.js";

export async function getProject(brandId, id) {
  return one(await query("SELECT * FROM projects WHERE brand_id = ? AND id = ?", [brandId, id]));
}

export async function getInvoiceRow(brandId, id) {
  return one(await query("SELECT * FROM invoices WHERE brand_id = ? AND id = ?", [brandId, id]));
}

export async function listInvoices(brandId, { projectId, clientId, limit = 200 } = {}) {
  const args = [brandId];
  let where = "i.brand_id = ?";
  if (projectId) { where += " AND i.project_id = ?"; args.push(projectId); }
  if (clientId) { where += " AND i.client_id = ?"; args.push(clientId); }
  args.push(limit);
  return query(
    `SELECT i.*, p.name AS project_name, c.name AS client_name FROM invoices i
     JOIN projects p ON p.id = i.project_id JOIN clients c ON c.id = i.client_id
     WHERE ${where} ORDER BY i.id DESC LIMIT ?`,
    args,
  );
}

/** Reserve a local row before calling PayPal, so a retry can reuse the same request id. */
export async function createInvoiceRow(brandId, { projectId, clientId, kind, amountCents, currency = "USD", recipientEmail, requestId }) {
  const rows = await query(
    `INSERT INTO invoices (brand_id, project_id, client_id, kind, amount_cents, currency, recipient_email, request_id, created_at)
     SELECT p.brand_id, p.id, c.id, ?, ?, ?, ?, ?, ? FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.brand_id = ? AND p.id = ? AND c.id = ? RETURNING id`,
    [kind, amountCents, currency, recipientEmail, requestId, now(), brandId, projectId, clientId],
  );
  if (!rows.length) throw new Error("Project not found.");
  return rows[0].id;
}

export async function markInvoiceCreated(brandId, id, { paypalId }) {
  await query("UPDATE invoices SET paypal_invoice_id = ?, status = 'DRAFT', last_error = NULL WHERE brand_id = ? AND id = ?", [paypalId, brandId, id]);
}

export async function markInvoiceFailed(brandId, id, message) {
  await query("UPDATE invoices SET status = 'FAILED', last_error = ? WHERE brand_id = ? AND id = ? AND paypal_invoice_id IS NULL", [String(message).slice(0, 300), brandId, id]);
}

export async function markInvoiceSent(brandId, id) {
  await query("UPDATE invoices SET sent_at = ? WHERE brand_id = ? AND id = ? AND sent_at IS NULL", [now(), brandId, id]);
}

export async function markInvoiceError(brandId, id, message) {
  await query("UPDATE invoices SET last_error = ?, last_synced_at = ? WHERE brand_id = ? AND id = ?", [String(message).slice(0, 300), now(), brandId, id]);
}

/**
 * Apply what PayPal says about an invoice. Returns { changed, becamePaid }. The timeline gets a
 * payment entry only on the step where it becomes paid, so running this twice never duplicates it.
 */
export async function applyInvoiceSync(brandId, id, { status, invoiceNumber, viewUrl, dueCents, paidCents, dueOn }) {
  const before = await getInvoiceRow(brandId, id);
  if (!before) return { changed: false, becamePaid: false };
  const wasPaid = statusGroup(before.status) === "paid";
  const nowPaid = statusGroup(status) === "paid";
  await query(
    `UPDATE invoices SET status = ?, invoice_number = COALESCE(?, invoice_number), view_url = COALESCE(?, view_url),
       due_cents = ?, due_on = COALESCE(?, due_on), paid_at = CASE WHEN ? AND paid_at IS NULL THEN ? ELSE paid_at END,
       last_synced_at = ?, last_error = NULL WHERE brand_id = ? AND id = ?`,
    [status, invoiceNumber, viewUrl, dueCents ?? null, dueOn, nowPaid, now(), now(), brandId, id],
  );
  const becamePaid = nowPaid && !wasPaid;
  if (becamePaid) {
    const client = await getClientById(brandId, before.client_id);
    if (client?.lead_id) {
      await addActivity(brandId, client.lead_id, {
        kind: "payment", body: "Invoice " + (invoiceNumber || before.invoice_number || "") + " paid (" + (paidCents != null ? paidCents / 100 : before.amount_cents / 100).toFixed(2) + " " + before.currency + ")",
        metadata: { invoiceId: id },
      });
    }
  }
  return { changed: before.status !== status, becamePaid };
}

const getClientById = async (brandId, id) => one(await query("SELECT * FROM clients WHERE brand_id = ? AND id = ?", [brandId, id]));

/** Total already billed on a project (failed and cancelled invoices do not count). */
export async function invoicedTotalForProject(brandId, projectId) {
  const rows = await query("SELECT status, amount_cents FROM invoices WHERE brand_id = ? AND project_id = ?", [brandId, projectId]);
  return rows.filter((r) => BILLED_GROUPS.includes(statusGroup(r.status))).reduce((sum, r) => sum + r.amount_cents, 0);
}

/** Money you are waiting on: what is still due on sent and partly paid invoices, and how much of it is late. */
export async function outstandingSummary(brandId, today) {
  const rows = await query("SELECT status, amount_cents, due_cents, due_on FROM invoices WHERE brand_id = ?", [brandId]);
  const owed = rows.filter((r) => OWED_GROUPS.includes(statusGroup(r.status)));
  const cents = (r) => r.due_cents ?? r.amount_cents;
  const late = owed.filter((r) => r.due_on && r.due_on < today);
  return {
    count: owed.length,
    outstandingCents: owed.reduce((a, r) => a + cents(r), 0),
    overdueCount: late.length,
    overdueCents: late.reduce((a, r) => a + cents(r), 0),
  };
}

// ---------- calendar ----------

import { dayAfterIso, dayStartIso } from "./calendar.js";

/** Everything dated inside a day range, for the calendar page. Money (invoices) only when asked. */
export async function calendarItems(brandId, { fromDay, toDay, includeMoney = false }) {
  const [meetings, tasks, campaigns, invoices] = await Promise.all([
    listMeetings(brandId, { fromIso: dayStartIso(fromDay), toIso: dayAfterIso(toDay), limit: 1000 }),
    query(
      `SELECT t.id, t.title, t.due_on, t.lead_id, l.name AS lead_name FROM tasks t JOIN leads l ON l.id = t.lead_id
       WHERE t.brand_id = ? AND t.done_at IS NULL AND t.due_on >= ? AND t.due_on <= ? ORDER BY t.due_on LIMIT 1000`,
      [brandId, fromDay, toDay],
    ),
    listCampaigns(brandId),
    includeMoney
      ? query(
          `SELECT i.id, i.status, i.amount_cents, i.due_cents, i.currency, i.due_on, i.invoice_number, c.name AS client_name
           FROM invoices i JOIN clients c ON c.id = i.client_id
           WHERE i.brand_id = ? AND i.due_on >= ? AND i.due_on <= ? LIMIT 500`,
          [brandId, fromDay, toDay],
        )
      : Promise.resolve([]),
  ]);
  return { meetings, tasks, campaigns, invoices: invoices.filter((i) => OWED_GROUPS.includes(statusGroup(i.status))) };
}

/** People a meeting can be scheduled with: contacts in the pipeline and clients. Picked from a list, not typed. */
export async function contactChoices(brandId, limit = 300) {
  const leads = await query(`SELECT l.id, l.name FROM leads l WHERE l.brand_id = ? AND ${IN_PIPELINE} ORDER BY l.name LIMIT ?`, [brandId, limit]);
  const clients = await query("SELECT id, name FROM clients WHERE brand_id = ? ORDER BY name LIMIT ?", [brandId, limit]);
  return [
    ...clients.map((c) => ({ value: `client:${c.id}`, label: `${c.name} (client)` })),
    ...leads.map((l) => ({ value: `lead:${l.id}`, label: l.name })),
  ];
}
