// Data access for the Social module. Same rules as lib/store.js: parameterized SQL only, and every query is
// scoped by brand_id so one tenant can never read or change another's rows.
import { query } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { newCode } from "./social/links.js";

const now = () => new Date().toISOString();
const one = (rows) => rows[0] || null;

// ---------- apps (one per mobile app, each with its own brand kit) ----------
export const listApps = (brandId, { archived = false } = {}) =>
  query("SELECT * FROM social_apps WHERE brand_id = ? AND archived = ? ORDER BY name", [brandId, archived]);
export async function getApp(brandId, id) {
  return one(await query("SELECT * FROM social_apps WHERE brand_id = ? AND id = ?", [brandId, id]));
}
export async function findAppByName(brandId, name) {
  return one(await query("SELECT * FROM social_apps WHERE brand_id = ? AND LOWER(name) = LOWER(?) AND archived = FALSE", [brandId, String(name || "").trim()]));
}
const APP_COLS = ["name", "tagline", "website", "store_url", "primary_color", "dark_color", "tone", "never_say", "ctas", "hashtags", "link_hosts"];
export async function createApp(brandId, a) {
  const rows = await query(
    `INSERT INTO social_apps (brand_id, ${APP_COLS.join(", ")}, created_at) VALUES (?, ${APP_COLS.map(() => "?").join(", ")}, ?) RETURNING id`,
    [brandId, ...APP_COLS.map((c) => a[c]), now()],
  );
  return rows[0].id;
}
export async function updateApp(brandId, id, a) {
  await query(`UPDATE social_apps SET ${APP_COLS.map((c) => `${c} = ?`).join(", ")} WHERE brand_id = ? AND id = ?`, [...APP_COLS.map((c) => a[c]), brandId, id]);
}
export const setAppArchived = (brandId, id, archived) => query("UPDATE social_apps SET archived = ? WHERE brand_id = ? AND id = ?", [archived, brandId, id]);

// ---------- accounts (tokens encrypted, never returned by list or get) ----------
const ACCOUNT_PUBLIC = "id, brand_id, app_id, platform, label, external_id, status, daily_cap, connected_at, last_checked_at, last_error, (secret_enc IS NOT NULL) AS has_secret";
export const listAccounts = (brandId, appId) =>
  query(`SELECT ${ACCOUNT_PUBLIC} FROM social_accounts WHERE brand_id = ? AND app_id = ?`, [brandId, appId]);
export async function getAccount(brandId, appId, platform) {
  return one(await query(`SELECT ${ACCOUNT_PUBLIC} FROM social_accounts WHERE brand_id = ? AND app_id = ? AND platform = ?`, [brandId, appId, platform]));
}
/** Create or update an account. A blank token keeps the one already saved. */
export async function saveAccount(brandId, appId, platform, { label = "", externalId = "", token = "", dailyCap = 1 }) {
  const enc = token ? encrypt(JSON.stringify({ token })) : null;
  await query(
    `INSERT INTO social_accounts (brand_id, app_id, platform, label, external_id, status, secret_enc, daily_cap, connected_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (app_id, platform) DO UPDATE SET label = EXCLUDED.label, external_id = EXCLUDED.external_id,
       secret_enc = COALESCE(EXCLUDED.secret_enc, social_accounts.secret_enc), daily_cap = EXCLUDED.daily_cap,
       status = 'connected', last_error = NULL, connected_at = COALESCE(social_accounts.connected_at, EXCLUDED.connected_at)
     WHERE social_accounts.brand_id = EXCLUDED.brand_id`,
    [brandId, appId, platform, label, externalId, "connected", enc, dailyCap, now()],
  );
}
export async function readAccountSecret(brandId, appId, platform) {
  const r = one(await query("SELECT secret_enc FROM social_accounts WHERE brand_id = ? AND app_id = ? AND platform = ?", [brandId, appId, platform]));
  if (!r?.secret_enc) return null;
  try { return JSON.parse(decrypt(r.secret_enc)); } catch { return null; }
}
export const recordAccountCheck = (brandId, appId, platform, { ok, message }) =>
  query("UPDATE social_accounts SET status = ?, last_checked_at = ?, last_error = ? WHERE brand_id = ? AND app_id = ? AND platform = ?",
    [ok ? "connected" : "error", now(), ok ? null : String(message).slice(0, 300), brandId, appId, platform]);
export const disconnectAccount = (brandId, appId, platform) =>
  query("UPDATE social_accounts SET status = 'disconnected', secret_enc = NULL, last_error = NULL, last_checked_at = ? WHERE brand_id = ? AND app_id = ? AND platform = ?", [now(), brandId, appId, platform]);

// ---------- posts and variants ----------
/** Creates a post with its variants as drafts. variants: [{platform, caption, hashtags, script, image:{headline,subline,cta}, link_target}] */
export async function createPost(brandId, appId, { topic, goal = "", source = "manual", createdBy = null, variants }) {
  const t = now();
  const rows = await query("INSERT INTO social_posts (brand_id, app_id, topic, goal, source, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id", [brandId, appId, topic, goal, source, createdBy, t]);
  const postId = rows[0].id;
  for (const v of variants) {
    await query(
      `INSERT INTO social_variants (brand_id, post_id, platform, caption, hashtags, script, link_target, image_headline, image_subline, image_cta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [brandId, postId, v.platform, v.caption, v.hashtags || "", v.script || "", v.link_target || "", v.image?.headline || "", v.image?.subline || "", v.image?.cta || "", t],
    );
  }
  return postId;
}
export async function getPost(brandId, id) {
  const p = one(await query("SELECT p.*, a.name AS app_name FROM social_posts p JOIN social_apps a ON a.id = p.app_id WHERE p.brand_id = ? AND p.id = ?", [brandId, id]));
  if (!p) return null;
  p.variants = await query("SELECT * FROM social_variants WHERE brand_id = ? AND post_id = ? ORDER BY id", [brandId, id]);
  return p;
}
export async function getVariant(brandId, id) {
  return one(await query(
    `SELECT v.*, p.app_id, p.topic FROM social_variants v JOIN social_posts p ON p.id = v.post_id WHERE v.brand_id = ? AND v.id = ?`, [brandId, id]));
}
export const deletePost = (brandId, id) => query("DELETE FROM social_posts WHERE brand_id = ? AND id = ?", [brandId, id]);

/** One row per variant for the calendar and queue. appId is optional (all apps when null). */
export function listVariants(brandId, { appId = null, status = null, limit = 300 } = {}) {
  const args = [brandId];
  let where = "v.brand_id = ?";
  if (appId) { where += " AND p.app_id = ?"; args.push(appId); }
  if (status) { where += " AND v.status = ?"; args.push(status); }
  args.push(limit);
  return query(
    `SELECT v.id, v.post_id, v.platform, v.status, v.caption, v.scheduled_at, v.published_at, v.permalink, v.error, v.created_at,
            p.topic, p.app_id, a.name AS app_name
       FROM social_variants v JOIN social_posts p ON p.id = v.post_id JOIN social_apps a ON a.id = p.app_id
      WHERE ${where} ORDER BY COALESCE(v.scheduled_at, v.published_at, v.created_at) DESC, v.id DESC LIMIT ?`, args);
}
export async function statusCounts(brandId, appId = null) {
  const args = [brandId];
  let where = "v.brand_id = ?";
  if (appId) { where += " AND p.app_id = ?"; args.push(appId); }
  const rows = await query(`SELECT v.status, COUNT(*)::int AS n FROM social_variants v JOIN social_posts p ON p.id = v.post_id WHERE ${where} GROUP BY v.status`, args);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** Editing text invalidates any approval and schedule: what was approved is no longer what would be posted. */
export const updateVariantText = (brandId, id, f) =>
  query(
    `UPDATE social_variants SET caption = ?, hashtags = ?, script = ?, link_target = ?, image_headline = ?, image_subline = ?, image_cta = ?,
       status = CASE WHEN status IN ('published','posted_manually','publishing') THEN status ELSE 'draft' END,
       approved_by = CASE WHEN status IN ('published','posted_manually','publishing') THEN approved_by ELSE NULL END,
       approved_at = CASE WHEN status IN ('published','posted_manually','publishing') THEN approved_at ELSE NULL END,
       scheduled_at = CASE WHEN status IN ('published','posted_manually','publishing') THEN scheduled_at ELSE NULL END
     WHERE brand_id = ? AND id = ? AND status NOT IN ('published','posted_manually','publishing')`,
    [f.caption, f.hashtags, f.script, f.link_target, f.image_headline, f.image_subline, f.image_cta, brandId, id]);

export const approveVariant = (brandId, id, userId) =>
  query("UPDATE social_variants SET status = 'approved', approved_by = ?, approved_at = ?, error = NULL WHERE brand_id = ? AND id = ? AND status IN ('draft','failed')", [userId, now(), brandId, id]);
export const rejectVariant = (brandId, id) =>
  query("UPDATE social_variants SET status = 'rejected', approved_by = NULL, approved_at = NULL, scheduled_at = NULL WHERE brand_id = ? AND id = ? AND status IN ('draft','approved','scheduled','failed')", [brandId, id]);
export const reopenVariant = (brandId, id) =>
  query("UPDATE social_variants SET status = 'draft', approved_by = NULL, approved_at = NULL, scheduled_at = NULL WHERE brand_id = ? AND id = ? AND status IN ('rejected','approved','scheduled')", [brandId, id]);
/** Scheduling needs an approval on record. The status guard means an unapproved variant can never be scheduled. */
export const scheduleVariant = (brandId, id, iso) =>
  query("UPDATE social_variants SET status = 'scheduled', scheduled_at = ? WHERE brand_id = ? AND id = ? AND status IN ('approved','scheduled') AND approved_by IS NOT NULL AND approved_at IS NOT NULL", [iso, brandId, id]);
export const unscheduleVariant = (brandId, id) =>
  query("UPDATE social_variants SET status = 'approved', scheduled_at = NULL WHERE brand_id = ? AND id = ? AND status = 'scheduled'", [brandId, id]);
export const markPostedManually = (brandId, id) =>
  query("UPDATE social_variants SET status = 'posted_manually', published_at = ? WHERE brand_id = ? AND id = ? AND status IN ('approved','scheduled')", [now(), brandId, id]);
export const retryVariant = (brandId, id, iso) =>
  query("UPDATE social_variants SET status = 'scheduled', scheduled_at = ?, error = NULL WHERE brand_id = ? AND id = ? AND status = 'failed' AND approved_by IS NOT NULL", [iso, brandId, id]);

// ---------- publishing support ----------
export const dueVariants = (brandId, iso, limit = 10) =>
  query(
    `SELECT v.*, p.app_id FROM social_variants v JOIN social_posts p ON p.id = v.post_id
      WHERE v.brand_id = ? AND v.status = 'scheduled' AND v.scheduled_at <= ? ORDER BY v.scheduled_at LIMIT ?`, [brandId, iso, limit]);
/** Takes the variant for publishing. Only one caller can win, so a double fired cron never posts twice. */
export async function claimVariant(brandId, id) {
  const r = await query("UPDATE social_variants SET status = 'publishing' WHERE brand_id = ? AND id = ? AND status = 'scheduled' RETURNING id", [brandId, id]);
  return r.length === 1;
}
export const markPublished = (brandId, id, { externalId, permalink }) =>
  query("UPDATE social_variants SET status = 'published', published_at = ?, external_id = ?, permalink = ?, error = NULL WHERE brand_id = ? AND id = ?", [now(), externalId, permalink || "", brandId, id]);
export const markFailed = (brandId, id, error) =>
  query("UPDATE social_variants SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE brand_id = ? AND id = ?", [String(error).slice(0, 300), brandId, id]);
/** A variant stuck in publishing (the app stopped mid post) is failed, never auto retried, because it may already be live. */
export const failStalePublishing = (brandId, beforeIso) =>
  query("UPDATE social_variants SET status = 'failed', error = 'Interrupted while publishing. Check the platform to see whether it went live before you retry.' WHERE brand_id = ? AND status = 'publishing' AND COALESCE(scheduled_at, created_at) < ?", [brandId, beforeIso]);
export async function countPublishedSince(brandId, appId, platform, sinceIso) {
  const r = one(await query(
    `SELECT COUNT(*)::int AS n FROM social_variants v JOIN social_posts p ON p.id = v.post_id
      WHERE v.brand_id = ? AND p.app_id = ? AND v.platform = ? AND v.status IN ('published','publishing') AND COALESCE(v.published_at, v.scheduled_at) >= ?`, [brandId, appId, platform, sinceIso]));
  return r?.n || 0;
}

// ---------- images ----------
export async function saveAsset(brandId, appId, { mime, buffer, origin = "template" }) {
  const r = await query("INSERT INTO social_assets (brand_id, app_id, mime, bytes, data, origin, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id", [brandId, appId, mime, buffer.length, buffer, origin, now()]);
  return r[0].id;
}
export async function getAsset(brandId, id) {
  const a = one(await query("SELECT id, app_id, mime, bytes, data, origin FROM social_assets WHERE brand_id = ? AND id = ?", [brandId, id]));
  return a ? { ...a, data: Buffer.from(a.data) } : null;
}
/** For the signed public media route only: the token already proves access, so this takes no brand. */
export async function getAssetBySignedId(id) {
  const a = one(await query("SELECT id, mime, data FROM social_assets WHERE id = ?", [id]));
  return a ? { ...a, data: Buffer.from(a.data) } : null;
}
export const setVariantAsset = (brandId, variantId, assetId) =>
  query("UPDATE social_variants SET asset_id = ? WHERE brand_id = ? AND id = ?", [assetId, brandId, variantId]);
export const deleteAsset = (brandId, id) => query("DELETE FROM social_assets WHERE brand_id = ? AND id = ?", [brandId, id]);

// ---------- tracked links ----------
/** One short link per variant. Reuses it if it exists and updates the destination if it changed. */
export async function ensureShortLink(brandId, appId, variantId, targetUrl) {
  const ex = one(await query("SELECT code, target_url FROM short_links WHERE brand_id = ? AND variant_id = ?", [brandId, variantId]));
  if (ex) {
    if (ex.target_url !== targetUrl) await query("UPDATE short_links SET target_url = ? WHERE brand_id = ? AND code = ?", [targetUrl, brandId, ex.code]);
    return ex.code;
  }
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const r = await query("INSERT INTO short_links (code, brand_id, app_id, variant_id, target_url, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING code", [code, brandId, appId, variantId, targetUrl, now()]);
    if (r.length) return code;
  }
  throw new Error("Could not make a short link.");
}
export async function getShortLinkForVariant(brandId, variantId) {
  return one(await query("SELECT * FROM short_links WHERE brand_id = ? AND variant_id = ?", [brandId, variantId]));
}
/** Public redirect: counts the visit (an aggregate number only) and returns the destination, or null for an unknown code. */
export async function recordClick(code) {
  const r = await query("UPDATE short_links SET clicks = clicks + 1, last_click_at = ? WHERE code = ? RETURNING target_url", [now(), code]);
  return r[0]?.target_url || null;
}
export const addInquiry = (brandId, variantId) =>
  query("UPDATE short_links SET inquiries = inquiries + 1 WHERE brand_id = ? AND variant_id = ?", [brandId, variantId]);
/** Clicks and inquiries per platform for one app (or all apps). Counts only. */
export function linkStats(brandId, appId = null) {
  const args = [brandId];
  let where = "s.brand_id = ?";
  if (appId) { where += " AND s.app_id = ?"; args.push(appId); }
  return query(
    `SELECT v.platform, a.name AS app_name, s.app_id, COUNT(*)::int AS links, SUM(s.clicks)::int AS clicks, SUM(s.inquiries)::int AS inquiries
       FROM short_links s JOIN social_variants v ON v.id = s.variant_id JOIN social_apps a ON a.id = s.app_id
      WHERE ${where} GROUP BY v.platform, a.name, s.app_id ORDER BY a.name, v.platform`, args);
}
