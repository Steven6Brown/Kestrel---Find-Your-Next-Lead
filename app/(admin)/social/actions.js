"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import { audit } from "@/lib/users";
import * as ss from "@/lib/socialstore";
import { appSchema, idSchema, parseImport, variantEditSchema } from "@/lib/social/schemas";
import { PLATFORM_IDS, PLATFORMS, isPlatform } from "@/lib/social/platforms";
import { getTemplate, readTemplateFields } from "@/lib/social/templates";
import { approve, ensureImage, publishDue } from "@/lib/social/service";
import { checkAccount } from "@/lib/social/adapters";
import { sanitizeUpload } from "@/lib/social/graphics";
import { allow } from "@/lib/ratelimit";
import { generate } from "@/lib/social/ai";

// Anyone signed in can draft. Approving, scheduling, posting and connecting accounts are owner and admin only.
const managers = { roles: ["owner", "admin"] };
const go = (path, msg, type = "ok") => redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, type })}`);
const ip = async () => (await clientInfo()).ip;
const num = (v) => { const r = idSchema.safeParse(v); return r.success ? r.data : null; };

async function appOr(formData, path) {
  const id = num(formData.get("app_id"));
  const app = id ? await ss.getApp(BRAND, id) : null;
  if (!app) go(path, "Choose an app first.", "bad");
  return app;
}

// ---------- apps and accounts ----------
export async function saveAppAction(formData) {
  const user = await requireUser(managers);
  const id = num(formData.get("id"));
  const parsed = appSchema.safeParse(Object.fromEntries(formData));
  const back = id ? `/social/apps/${id}` : "/social/apps";
  if (!parsed.success) go(back, `${parsed.error.issues[0].path.join(" ") || "Value"} ${parsed.error.issues[0].message}.`, "bad");
  try {
    if (id) {
      if (!(await ss.getApp(BRAND, id))) go("/social/apps", "That app was not found.", "bad");
      await ss.updateApp(BRAND, id, parsed.data);
      await audit(BRAND, user.id, "social_app_updated", parsed.data.name, await ip());
      revalidatePath("/social", "layout");
      go(back, "Saved.");
    }
    const newId = await ss.createApp(BRAND, parsed.data);
    await audit(BRAND, user.id, "social_app_created", parsed.data.name, await ip());
    revalidatePath("/social", "layout");
    go(`/social/apps/${newId}`, "App added. Now connect its accounts.");
  } catch (e) {
    if (e?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    go(back, "Could not save. An app with that name may already exist.", "bad");
  }
}

export async function archiveAppAction(formData) {
  const user = await requireUser(managers);
  const id = num(formData.get("id"));
  if (!id || !(await ss.getApp(BRAND, id))) go("/social/apps", "That app was not found.", "bad");
  await ss.setAppArchived(BRAND, id, formData.get("restore") !== "1");
  await audit(BRAND, user.id, "social_app_archived", String(id), await ip());
  revalidatePath("/social", "layout");
  go("/social/apps", formData.get("restore") === "1" ? "App restored." : "App archived. Its posts are kept.");
}

export async function saveAccountAction(formData) {
  const user = await requireUser(managers);
  const app = await appOr(formData, "/social/apps");
  const back = `/social/apps/${app.id}`;
  const platform = String(formData.get("platform"));
  if (!isPlatform(platform) || !PLATFORMS[platform].direct) go(back, "That platform is posted by hand.", "bad");
  const externalId = String(formData.get("external_id") || "").trim();
  if (!/^[A-Za-z0-9_\-:.]{1,80}$/.test(externalId)) go(back, "The account id looks wrong. Use only letters, numbers and dashes.", "bad");
  const token = String(formData.get("token") || "").trim();
  if (token.length > 4000) go(back, "That token is too long.", "bad");
  const existing = await ss.getAccount(BRAND, app.id, platform);
  if (!token && !existing?.has_secret) go(back, "Paste the access token.", "bad");
  const cap = Number(formData.get("daily_cap"));
  await ss.saveAccount(BRAND, app.id, platform, { label: String(formData.get("label") || "").trim().slice(0, 80), externalId, token, dailyCap: Number.isInteger(cap) && cap >= 1 && cap <= 10 ? cap : 1 });
  await audit(BRAND, user.id, "social_account_connected", `${app.name}: ${platform}`, await ip()); // never the token
  revalidatePath(back);
  go(back, `${PLATFORMS[platform].name} saved. Press Test to check it.`);
}

export async function checkAccountAction(formData) {
  const user = await requireUser(managers);
  const app = await appOr(formData, "/social/apps");
  const back = `/social/apps/${app.id}`;
  const platform = String(formData.get("platform"));
  const account = isPlatform(platform) ? await ss.getAccount(BRAND, app.id, platform) : null;
  if (!account) go(back, "Save the account first.", "bad");
  let r;
  try { r = await checkAccount({ platform, account, secret: await ss.readAccountSecret(BRAND, app.id, platform) }); } catch { r = { ok: false, message: "The check failed unexpectedly." }; }
  await ss.recordAccountCheck(BRAND, app.id, platform, r);
  await audit(BRAND, user.id, "social_account_checked", `${app.name}: ${platform} ${r.ok ? "ok" : "failed"}`, await ip());
  revalidatePath(back);
  go(back, r.message, r.ok ? "ok" : "bad");
}

export async function disconnectAccountAction(formData) {
  const user = await requireUser(managers);
  const app = await appOr(formData, "/social/apps");
  const platform = String(formData.get("platform"));
  if (isPlatform(platform)) await ss.disconnectAccount(BRAND, app.id, platform);
  await audit(BRAND, user.id, "social_account_disconnected", `${app.name}: ${platform}`, await ip());
  revalidatePath(`/social/apps/${app.id}`);
  go(`/social/apps/${app.id}`, "Disconnected and the saved token was erased. Also remove this app's access inside the platform's own settings.");
}

// ---------- making posts ----------
async function renderAll(app, postId) {
  const post = await ss.getPost(BRAND, postId);
  for (const v of post.variants) {
    try { await ensureImage(BRAND, app, { ...v, topic: post.topic }); } catch { /* the post is still usable; the owner can regenerate or upload */ }
  }
}

export async function composeTemplateAction(formData) {
  const user = await requireUser();
  const app = await appOr(formData, "/social/new");
  const t = getTemplate(String(formData.get("template")));
  if (!t) go("/social/new", "Choose a format.", "bad");
  const f = readTemplateFields(t, (k) => formData.get(`f_${k}`));
  if (!f.ok) go("/social/new", f.error, "bad");
  const built = t.build(f.values, app);
  const link = String(formData.get("link") || "").trim();
  const postId = await ss.createPost(BRAND, app.id, {
    topic: built.topic, goal: String(formData.get("goal") || "").slice(0, 200), source: "template", createdBy: user.id,
    variants: built.variants.map((v) => ({ ...v, link_target: link })),
  });
  await renderAll(app, postId);
  go(`/social/post/${postId}`, "Drafts made for all four platforms. Check each one, then approve.");
}

export async function composeManualAction(formData) {
  const user = await requireUser();
  const app = await appOr(formData, "/social/new");
  const topic = String(formData.get("topic") || "").trim().slice(0, 140);
  const caption = String(formData.get("caption") || "").trim();
  const platforms = PLATFORM_IDS.filter((p) => formData.getAll("platforms").includes(p));
  if (!topic || !caption || !platforms.length) go("/social/new", "Add a topic, the text, and at least one platform.", "bad");
  const base = variantEditSchema.safeParse({ caption, hashtags: String(formData.get("hashtags") || ""), link_target: String(formData.get("link") || ""), image_headline: String(formData.get("headline") || topic).slice(0, 90) });
  if (!base.success) go("/social/new", `${base.error.issues[0].path.join(" ")} ${base.error.issues[0].message}.`, "bad");
  const postId = await ss.createPost(BRAND, app.id, {
    topic, source: "manual", createdBy: user.id,
    variants: platforms.map((platform) => ({ platform, caption: base.data.caption, hashtags: base.data.hashtags, link_target: base.data.link_target, image: { headline: base.data.image_headline, subline: "", cta: "" } })),
  });
  await renderAll(app, postId);
  go(`/social/post/${postId}`, "Draft saved.");
}

export async function importAction(formData) {
  const user = await requireUser();
  if (!allow(`social-import:${user.id}`, 20, 60_000)) go("/social/import", "Slow down a little and try again.", "bad");
  const defaultApp = num(formData.get("app_id"));
  const r = parseImport(formData.get("json"));
  if (!r.ok) go("/social/import", r.error, "bad");
  let last = null;
  const made = [];
  for (const p of r.posts) {
    const app = (p.app ? await ss.findAppByName(BRAND, p.app) : null) || (defaultApp ? await ss.getApp(BRAND, defaultApp) : null);
    if (!app) go("/social/import", `Post "${p.topic}": choose an app, or use an app name that exists.`, "bad");
    made.push({ app, p });
  }
  for (const { app, p } of made) {
    last = await ss.createPost(BRAND, app.id, {
      topic: p.topic, goal: p.goal, source: "import", createdBy: user.id,
      variants: p.variants.map((v) => ({ ...v, link_target: "" })),
    });
    await renderAll(app, last);
  }
  await audit(BRAND, user.id, "social_import", `${made.length} post(s)`, await ip());
  go(made.length === 1 ? `/social/post/${last}` : "/social/queue", `${made.length} draft${made.length === 1 ? "" : "s"} imported. Nothing is posted until you approve it.`);
}

// Writes drafts with the AI. This spends money, so it is owner and admin only and goes through the monthly cap.
export async function writeWithAiAction(formData) {
  const user = await requireUser(managers);
  if (!allow(`social-ai:${user.id}`, 6, 60_000)) go("/social/write", "Slow down a little and try again.", "bad");
  const app = await appOr(formData, "/social/write");
  const idea = String(formData.get("idea") || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  const facts = String(formData.get("facts") || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (idea.length < 5 || idea.length > 600) go("/social/write", "Say what to promote, in 5 to 600 characters.", "bad");
  if (facts.length > 1500) go("/social/write", "Keep the facts under 1500 characters.", "bad");
  const count = Math.min(Math.max(Number(formData.get("count")) || 1, 1), 3);
  const platforms = PLATFORM_IDS.filter((p) => formData.getAll("platforms").includes(p));
  const r = await generate({
    app, idea, facts, count, platforms,
    deps: { getSpend: async (m) => (await ss.getAiUsage(BRAND, m)).cost, addSpend: (m, u) => ss.addAiUsage(BRAND, m, u) },
  });
  await audit(BRAND, user.id, "social_ai_write", r.ok ? `${r.posts.length} post(s) for ${app.name}` : "no result", await ip());
  if (!r.ok) go("/social/write", r.error, "bad");
  let last = null;
  for (const p of r.posts) {
    last = await ss.createPost(BRAND, app.id, { topic: p.topic, goal: p.goal, source: "import", createdBy: user.id, variants: p.variants.map((v) => ({ ...v, link_target: "" })) });
    await renderAll(app, last);
  }
  revalidatePath("/social", "layout");
  go(r.posts.length === 1 ? `/social/post/${last}` : "/social/queue", `The AI wrote ${r.posts.length} draft${r.posts.length === 1 ? "" : "s"}. Read each one carefully and check every claim before approving.`);
}

// ---------- editing, approving, scheduling ----------
async function variantOr(formData) {
  const id = num(formData.get("variant_id"));
  const v = id ? await ss.getVariant(BRAND, id) : null;
  if (!v) go("/social/queue", "That post was not found.", "bad");
  return v;
}
const postPath = (v) => `/social/post/${v.post_id}`;
const refresh = (v) => { revalidatePath(postPath(v)); revalidatePath("/social", "layout"); };

export async function saveVariantAction(formData) {
  await requireUser();
  const v = await variantOr(formData);
  const f = variantEditSchema.safeParse({
    caption: formData.get("caption") ?? "", hashtags: formData.get("hashtags") ?? "", script: formData.get("script") ?? "",
    link_target: formData.get("link_target") ?? "", image_headline: formData.get("image_headline") ?? "",
    image_subline: formData.get("image_subline") ?? "", image_cta: formData.get("image_cta") ?? "",
  });
  if (!f.success) go(postPath(v), `${f.error.issues[0].path.join(" ")} ${f.error.issues[0].message}.`, "bad");
  if (["published", "posted_manually", "publishing"].includes(v.status)) go(postPath(v), "This one is already posted and cannot be edited.", "bad");
  await ss.updateVariantText(BRAND, v.id, f.data);
  refresh(v);
  go(postPath(v), v.status === "draft" ? "Saved." : "Saved. Because the text changed, it needs approving again.");
}

export async function regenImageAction(formData) {
  await requireUser();
  const v = await variantOr(formData);
  const app = await ss.getApp(BRAND, v.app_id);
  if (["published", "posted_manually", "publishing"].includes(v.status)) go(postPath(v), "Already posted.", "bad");
  await ensureImage(BRAND, app, v, { force: true });
  await ss.reopenVariant(BRAND, v.id); // a changed image needs a fresh look
  refresh(v);
  go(postPath(v), "Graphic rebuilt from the headline, line and button text. Approve again after you look at it.");
}

export async function uploadImageAction(formData) {
  await requireUser();
  const v = await variantOr(formData);
  const file = formData.get("image");
  if (!file || typeof file === "string" || !file.size) go(postPath(v), "Choose an image file.", "bad");
  if (file.size > 5 * 1024 * 1024) go(postPath(v), "That image is over 5 MB.", "bad");
  const s = await sanitizeUpload(Buffer.from(await file.arrayBuffer()));
  if (!s.ok) go(postPath(v), s.error, "bad");
  const id = await ss.saveAsset(BRAND, v.app_id, { mime: s.mime, buffer: s.buffer, origin: "upload" });
  const old = v.asset_id;
  await ss.setVariantAsset(BRAND, v.id, id);
  if (old) await ss.deleteAsset(BRAND, old);
  await ss.reopenVariant(BRAND, v.id);
  refresh(v);
  go(postPath(v), "Your image is attached. Location and camera details were removed. Approve again after you look at it.");
}

export async function approveAction(formData) {
  const user = await requireUser(managers);
  const v = await variantOr(formData);
  const r = await approve(BRAND, v.id, user.id, { checklistTicked: ["a", "b", "c"].every((k) => formData.get(`check_${k}`) === "on") });
  if (!r.ok) go(postPath(v), r.problems.join(" "), "bad");
  await audit(BRAND, user.id, "social_approved", `variant ${v.id} ${v.platform}`, await ip());
  refresh(v);
  go(postPath(v), "Approved. Now pick a time, or post it.");
}

export async function rejectAction(formData) {
  const user = await requireUser(managers);
  const v = await variantOr(formData);
  await ss.rejectVariant(BRAND, v.id);
  await audit(BRAND, user.id, "social_rejected", `variant ${v.id}`, await ip());
  refresh(v);
  go(postPath(v), "Rejected. It will not be posted.");
}

export async function reopenAction(formData) {
  await requireUser(managers);
  const v = await variantOr(formData);
  await ss.reopenVariant(BRAND, v.id);
  refresh(v);
  go(postPath(v), "Moved back to draft.");
}

export async function scheduleAction(formData) {
  const user = await requireUser(managers);
  const v = await variantOr(formData);
  const when = new Date(String(formData.get("when") || ""));
  if (Number.isNaN(when.getTime())) go(postPath(v), "Pick a date and time.", "bad");
  if (when.getTime() < Date.now() - 60_000) go(postPath(v), "That time has passed. Pick a later time, or use Post now.", "bad");
  if (!PLATFORMS[v.platform].direct) go(postPath(v), "TikTok is posted by hand. Use Mark as posted after you upload it.", "bad");
  await ss.scheduleVariant(BRAND, v.id, when.toISOString());
  if ((await ss.getVariant(BRAND, v.id)).status !== "scheduled") go(postPath(v), "Approve it first.", "bad");
  await audit(BRAND, user.id, "social_scheduled", `variant ${v.id} for ${when.toISOString()}`, await ip());
  refresh(v);
  go(postPath(v), `Scheduled for ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Kestrel must be running (or hosted) at that time.`);
}

export async function unscheduleAction(formData) {
  await requireUser(managers);
  const v = await variantOr(formData);
  await ss.unscheduleVariant(BRAND, v.id);
  refresh(v);
  go(postPath(v), "Unscheduled. It is still approved.");
}

export async function postNowAction(formData) {
  const user = await requireUser(managers);
  const v = await variantOr(formData);
  if (!PLATFORMS[v.platform].direct) go(postPath(v), "TikTok is posted by hand.", "bad");
  await ss.scheduleVariant(BRAND, v.id, new Date().toISOString());
  if ((await ss.getVariant(BRAND, v.id)).status !== "scheduled") go(postPath(v), "Approve it first.", "bad");
  await audit(BRAND, user.id, "social_post_now", `variant ${v.id}`, await ip());
  const r = await publishDue(BRAND);
  refresh(v);
  const after = await ss.getVariant(BRAND, v.id);
  if (after.status === "published") go(postPath(v), "Posted.");
  if (after.status === "failed") go(postPath(v), after.error || "The post failed.", "bad");
  go(postPath(v), r.deferred ? "Held back by this account's daily limit. It will post on a later run." : "Queued.");
}

export async function retryAction(formData) {
  await requireUser(managers);
  const v = await variantOr(formData);
  await ss.retryVariant(BRAND, v.id, new Date().toISOString());
  refresh(v);
  go(postPath(v), "Queued again. Press Post now, or wait for the next scheduled run.");
}

export async function markPostedAction(formData) {
  const user = await requireUser(managers);
  const v = await variantOr(formData);
  await ss.markPostedManually(BRAND, v.id);
  await audit(BRAND, user.id, "social_posted_manually", `variant ${v.id} ${v.platform}`, await ip());
  refresh(v);
  go(postPath(v), "Marked as posted.");
}

export async function inquiryAction(formData) {
  await requireUser();
  const v = await variantOr(formData);
  await ss.addInquiry(BRAND, v.id);
  refresh(v);
  go(postPath(v), "Counted one inquiry for this post.");
}

export async function deletePostAction(formData) {
  const user = await requireUser(managers);
  const id = num(formData.get("post_id"));
  const post = id ? await ss.getPost(BRAND, id) : null;
  if (!post) go("/social", "That post was not found.", "bad");
  if (post.variants.some((v) => ["publishing", "published"].includes(v.status))) go(`/social/post/${id}`, "A post that went live cannot be deleted here. Delete it on the platform.", "bad");
  await ss.deletePost(BRAND, id);
  await audit(BRAND, user.id, "social_post_deleted", `post ${id}`, await ip());
  revalidatePath("/social", "layout");
  go("/social", "Deleted.");
}
