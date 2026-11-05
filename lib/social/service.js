// Orchestration for the Social module: checks, images, the approval gate and the publisher.
// No Next.js imports, so the whole flow is testable. The publisher re-checks everything server side:
// the status, the approval on record, the platform rules and the never say list, right before posting.
import * as ss from "../socialstore.js";
import { PLATFORMS, checkVariant, finalText } from "./platforms.js";
import { validateTarget, withUtm, shortUrl, mediaUrl } from "./links.js";
import { renderCard } from "./graphics.js";
import { adapters } from "./adapters.js";
import { isPublicHttps } from "../tokens.js";

const DAY = 24 * 3600 * 1000;

/** Rule checks for one stored variant, using a same length stand in for the short link so the count is right. */
export function variantChecks(app, v) {
  const link = v.link_target ? shortUrl("xxxxxxxx") : "";
  const r = checkVariant({ platform: v.platform, caption: v.caption, hashtags: v.hashtags, link, hasImage: !!v.asset_id, neverSay: app.never_say });
  if (v.link_target) {
    const t = validateTarget(v.link_target, app);
    if (!t.ok) r.problems.push(t.error);
  }
  return r;
}

/** Renders this variant's template card (or keeps an uploaded image the owner chose) and attaches it. */
export async function ensureImage(brandId, app, v, { force = false } = {}) {
  if (!PLATFORMS[v.platform]) return null;
  if (v.asset_id && !force) {
    const a = await ss.getAsset(brandId, v.asset_id);
    if (a && a.origin === "upload") return v.asset_id;
    if (a && !force) return v.asset_id;
  }
  const buffer = await renderCard({
    platform: v.platform,
    kit: { name: app.name, primary_color: app.primary_color, dark_color: app.dark_color },
    content: { headline: v.image_headline || v.topic || app.name, subline: v.image_subline, cta: v.image_cta },
  });
  const id = await ss.saveAsset(brandId, app.id, { mime: "image/png", buffer, origin: "template" });
  const old = v.asset_id;
  await ss.setVariantAsset(brandId, v.id, id);
  if (old && old !== id) await ss.deleteAsset(brandId, old);
  return id;
}

/** The approval gate. Returns { ok } or { ok: false, problems }. The checklist must be ticked by the person approving. */
export async function approve(brandId, variantId, userId, { checklistTicked }) {
  const v = await ss.getVariant(brandId, variantId);
  if (!v) return { ok: false, problems: ["That post was not found."] };
  const app = await ss.getApp(brandId, v.app_id);
  if (!checklistTicked) return { ok: false, problems: ["Tick all three checks first."] };
  if (!["draft", "failed"].includes(v.status)) return { ok: false, problems: [`This is already ${v.status}.`] };
  const { problems } = variantChecks(app, v);
  if (problems.length) return { ok: false, problems };
  await ss.approveVariant(brandId, variantId, userId);
  return { ok: true };
}

/**
 * Publishes due variants for one tenant. One at a time. For each: claim it (so it can never post twice), re check every
 * rule, enforce the daily cap, post through the adapter, record the id and link or the failure. A failure on one platform
 * never stops the others. fetchImpl and env are injected for tests.
 */
export async function publishDue(brandId, { env = process.env, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const nowIso = new Date(nowMs).toISOString();
  await ss.failStalePublishing(brandId, new Date(nowMs - 15 * 60 * 1000).toISOString());
  const results = { published: 0, failed: 0, deferred: 0 };
  for (const row of await ss.dueVariants(brandId, nowIso)) {
    const spec = PLATFORMS[row.platform];
    const fail = async (msg) => { await ss.markFailed(brandId, row.id, msg); results.failed++; };
    if (!spec?.direct) continue;
    const app = await ss.getApp(brandId, row.app_id);
    const account = app ? await ss.getAccount(brandId, row.app_id, row.platform) : null;
    // Daily cap: leave it scheduled for a later run rather than failing it.
    if (account && (await ss.countPublishedSince(brandId, row.app_id, row.platform, new Date(nowMs - DAY).toISOString())) >= account.daily_cap) { results.deferred++; continue; }
    if (!(await ss.claimVariant(brandId, row.id))) continue;
    try {
      if (!row.approved_by || !row.approved_at) { await fail("Not approved. Nothing was posted."); continue; }
      if (!app) { await fail("The app for this post no longer exists."); continue; }
      if (!account || account.status === "disconnected") { await fail(`${spec.name} is not connected for ${app.name}.`); continue; }
      const secret = await ss.readAccountSecret(brandId, row.app_id, row.platform);
      if (!secret?.token) { await fail("No saved token. Reconnect the account."); continue; }
      const v = { ...row, topic: "" };
      const { problems } = variantChecks(app, v);
      if (problems.length) { await fail(`Blocked by the checks: ${problems[0]}`); continue; }

      let link = "";
      if (row.link_target) {
        const t = validateTarget(row.link_target, app);
        const code = await ss.ensureShortLink(brandId, row.app_id, row.id, withUtm(t.url, { platform: row.platform, variantId: row.id }));
        link = shortUrl(code);
      }
      const text = finalText({ caption: row.caption, hashtags: row.hashtags, link });
      let imageUrl = "";
      let imageBytes = null;
      if (row.asset_id) {
        if (row.platform === "linkedin") imageBytes = (await ss.getAsset(brandId, row.asset_id))?.data || null;
        else {
          if (!isPublicHttps(mediaUrl(row.asset_id))) { await fail("Kestrel is not on a public https address yet, so the platform cannot fetch the image. Host Kestrel and set APP_BASE_URL first."); continue; }
          imageUrl = mediaUrl(row.asset_id, 3600);
        }
      }
      const r = await adapters[row.platform]({ account, secret, text, imageUrl, imageBytes, env, fetchImpl });
      if (r.ok) { await ss.markPublished(brandId, row.id, r); results.published++; } else await fail(r.error);
    } catch {
      await fail("Unexpected error while posting. Check the platform before retrying.");
    }
  }
  return results;
}
