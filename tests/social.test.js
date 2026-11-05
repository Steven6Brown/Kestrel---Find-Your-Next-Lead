import test from "node:test";
import assert from "node:assert/strict";

process.env.PGLITE_DIR = "memory";
process.env.KESTREL_DATA_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "kestrel-social-"));
delete process.env.DATABASE_URL;
process.env.APP_SECRET = "test-secret-test-secret-123";
process.env.APP_BASE_URL = "https://kestrel.example.test";

const { parseImport, appSchema, variantEditSchema } = await import("../lib/social/schemas.js");
const { checkVariant, parseHashtags, finalText, findNeverSay } = await import("../lib/social/platforms.js");
const { TEMPLATES, readTemplateFields } = await import("../lib/social/templates.js");
const { cardSvg, renderCard, wrap, sanitizeUpload } = await import("../lib/social/graphics.js");
const { validateTarget, withUtm, signMedia, verifyMedia, validCode } = await import("../lib/social/links.js");
const ss = await import("../lib/socialstore.js");
const { approve, publishDue, variantChecks, ensureImage } = await import("../lib/social/service.js");
const { checkAccount } = await import("../lib/social/adapters.js");
const { query } = await import("../lib/db.js");

const B = "aquila";
const mkApp = (name = "FitTrack", extra = {}) => ss.createApp(B, { ...appSchema.parse({ name, website: "https://fittrack.example.test", never_say: "guaranteed\nbest in the world", hashtags: "fittrack #health", ...extra }) });

test("hashtags are cleaned and de-duplicated", () => {
  assert.deepEqual(parseHashtags("#Tips, tips  #IT-Security  #a_b"), ["Tips", "ITSecurity", "a_b"]);
  assert.equal(finalText({ caption: " Hi ", hashtags: "x y", link: "https://a.test" }), "Hi\n\n#x #y\n\nhttps://a.test");
});

test("import: accepts JSON, fenced JSON and lists; rejects junk and duplicates", () => {
  const post = { topic: "Tip", variants: [{ platform: "facebook", caption: "Hello", hashtags: ["a", "#b"] }] };
  assert.equal(parseImport(JSON.stringify(post)).ok, true);
  assert.equal(parseImport("Here you go:\n```json\n" + JSON.stringify([post, post]) + "\n```").posts.length, 2);
  assert.equal(parseImport("not json").ok, false);
  assert.equal(parseImport("").ok, false);
  assert.equal(parseImport(JSON.stringify({ topic: "x", variants: [{ platform: "myspace", caption: "x" }] })).ok, false);
  assert.equal(parseImport(JSON.stringify({ ...post, variants: [post.variants[0], post.variants[0]] })).ok, false);
  const ctl = parseImport(JSON.stringify({ topic: "a\u0000b", variants: [{ platform: "linkedin", caption: "x\u0007y" }] }));
  assert.equal(ctl.posts[0].topic, "ab");
  assert.equal(ctl.posts[0].variants[0].caption, "xy");
  assert.equal(parseImport(JSON.stringify(Array(21).fill(post))).ok, false);
});

test("platform checks: length, hashtags, image, never say", () => {
  const ok = checkVariant({ platform: "instagram", caption: "Hi", hashtags: "a", hasImage: true });
  assert.deepEqual(ok.problems, []);
  assert.ok(checkVariant({ platform: "instagram", caption: "Hi", hasImage: false }).problems.some((p) => /image/.test(p)));
  assert.ok(checkVariant({ platform: "instagram", caption: "x".repeat(2300), hasImage: true }).problems.some((p) => /Too long/.test(p)));
  assert.ok(checkVariant({ platform: "linkedin", caption: "x", hashtags: "a b c d e f" }).problems.some((p) => /hashtags/.test(p)));
  assert.ok(checkVariant({ platform: "facebook", caption: "This is GUARANTEED", neverSay: "guaranteed" }).problems.some((p) => /never say/.test(p)));
  assert.ok(checkVariant({ platform: "facebook", caption: " " }).problems.length);
  assert.deepEqual(findNeverSay("clean text", "a\nb"), []);
});

test("every template builds four valid variants from only the typed fields", () => {
  const app = { name: "FitTrack", tagline: "t", hashtags: "fittrack" };
  for (const t of TEMPLATES) {
    const f = Object.fromEntries(t.fields.map((x) => [x.key, `value for ${x.key}`]));
    const r = t.build(f, app);
    assert.equal(r.variants.length, 4);
    for (const v of r.variants) {
      const c = checkVariant({ platform: v.platform, caption: v.caption, hashtags: v.hashtags, hasImage: true });
      assert.deepEqual(c.problems, [], `${t.id}/${v.platform}`);
    }
  }
  assert.equal(readTemplateFields(TEMPLATES[0], () => "").ok, false);
  assert.equal(readTemplateFields(TEMPLATES[0], () => "x".repeat(1000)).ok, false);
});

test("graphics: text is escaped, wrapping is bounded, PNG has the platform size", async () => {
  const svg = cardSvg({ width: 1080, height: 1350, kit: { name: "A<b>&", primary_color: "#C08A2E", dark_color: "#0B0E13" }, content: { headline: "<script>alert(1)</script>", subline: "", cta: "Get it" } });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!/gradient/i.test(svg));
  assert.equal(wrap("one two three four five six seven", 10, 2).length, 2);
  const { default: sharp } = await import("sharp");
  for (const [p, w, h] of [["instagram", 1080, 1350], ["linkedin", 1200, 627], ["facebook", 1200, 630]]) {
    const png = await renderCard({ platform: p, kit: { name: "App", primary_color: "#C08A2E", dark_color: "#0B0E13" }, content: { headline: "A long headline that needs to wrap over several lines to fit", subline: "Subline", cta: "Get the app" } });
    const m = await sharp(png).metadata();
    assert.deepEqual([m.format, m.width, m.height], ["png", w, h]);
  }
  assert.equal((await sanitizeUpload(Buffer.from("not an image"))).ok, false);
  const jpg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).jpeg().withExif({ IFD0: { Copyright: "secret" } }).toBuffer();
  const clean = await sanitizeUpload(jpg);
  assert.equal(clean.ok, true);
  assert.equal((await sharp(clean.buffer).metadata()).exif, undefined);
});

test("links: allowlist blocks other hosts and http, signed media expires and resists tampering", () => {
  const app = { website: "https://fittrack.example.test", store_url: "", link_hosts: "" };
  assert.equal(validateTarget("https://fittrack.example.test/x", app).ok, true);
  assert.equal(validateTarget("https://apps.apple.com/app/id1", app).ok, true);
  assert.equal(validateTarget("https://evil.test/", app).ok, false);
  assert.equal(validateTarget("http://fittrack.example.test/", app).ok, false);
  assert.equal(validateTarget("https://user:pw@fittrack.example.test/", app).ok, false);
  assert.equal(validateTarget("javascript:alert(1)", app).ok, false);
  const u = new URL(withUtm("https://fittrack.example.test/x", { platform: "facebook", variantId: 7 }));
  assert.equal(u.searchParams.get("utm_campaign"), "post-7");
  const t = signMedia(5, 60, 1_000_000);
  assert.equal(verifyMedia(t, 1_000_000), 5);
  assert.equal(verifyMedia(t, 1_000_000 + 61_000), null);
  assert.equal(verifyMedia(t.replace(/^5/, "6"), 1_000_000), null);
  assert.equal(verifyMedia("garbage"), null);
  assert.equal(validCode("abcd2345"), true);
  assert.equal(validCode("../etc"), false);
});

test("store: apps are brand scoped, tokens are encrypted and never listed", async () => {
  const id = await mkApp("ScopeApp");
  assert.ok(await ss.getApp(B, id));
  assert.equal(await ss.getApp("other-brand", id), null);
  assert.equal((await ss.listApps("other-brand")).length, 0);
  await ss.saveAccount(B, id, "facebook", { label: "Page", externalId: "123", token: "SECRET-TOKEN-VALUE", dailyCap: 2 });
  const listed = await ss.listAccounts(B, id);
  assert.equal(listed.length, 1);
  assert.ok(!JSON.stringify(listed).includes("SECRET-TOKEN-VALUE"));
  assert.equal(listed[0].secret_enc, undefined);
  const raw = await query("SELECT secret_enc FROM social_accounts WHERE app_id = ?", [id]);
  assert.ok(!raw[0].secret_enc.includes("SECRET-TOKEN-VALUE"));
  assert.equal((await ss.readAccountSecret(B, id, "facebook")).token, "SECRET-TOKEN-VALUE");
  assert.equal(await ss.readAccountSecret("other-brand", id, "facebook"), null);
  await ss.saveAccount(B, id, "facebook", { label: "Page", externalId: "123", token: "", dailyCap: 2 });
  assert.equal((await ss.readAccountSecret(B, id, "facebook")).token, "SECRET-TOKEN-VALUE", "blank token keeps the saved one");
  await ss.disconnectAccount(B, id, "facebook");
  assert.equal(await ss.readAccountSecret(B, id, "facebook"), null);
});

async function setup(platforms = ["facebook"], opts = {}) {
  const appId = await mkApp("App" + Math.random().toString(36).slice(2, 7));
  const app = await ss.getApp(B, appId);
  for (const p of platforms) await ss.saveAccount(B, appId, p, { label: p, externalId: "ext1", token: "tok", dailyCap: opts.cap || 3 });
  const postId = await ss.createPost(B, appId, {
    topic: "Launch", source: "template", variants: platforms.map((p) => ({ platform: p, caption: "Hello world", hashtags: "a b", link_target: opts.link || "", image: { headline: "Launch", subline: "now", cta: "Get it" } })),
  });
  const post = await ss.getPost(B, postId);
  return { appId, app, post, vs: post.variants };
}
const ticked = { checklistTicked: true };

test("approval gate: needs the checklist, passes rules, edits undo it, scheduling needs it", async () => {
  const { app, vs: [v] } = await setup(["facebook"]);
  assert.equal((await approve(B, v.id, 1, { checklistTicked: false })).ok, false);
  await ss.updateVariantText(B, v.id, { caption: "This is guaranteed!", hashtags: "", script: "", link_target: "", image_headline: "", image_subline: "", image_cta: "" });
  const bad = await approve(B, v.id, 1, ticked);
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /never say/);
  await ss.updateVariantText(B, v.id, { caption: "Fine text", hashtags: "a", script: "", link_target: "", image_headline: "", image_subline: "", image_cta: "" });
  // scheduling an unapproved variant does nothing
  await ss.scheduleVariant(B, v.id, new Date().toISOString());
  assert.equal((await ss.getVariant(B, v.id)).status, "draft");
  assert.equal((await approve(B, v.id, 7, ticked)).ok, true);
  let row = await ss.getVariant(B, v.id);
  assert.equal(row.status, "approved");
  assert.equal(row.approved_by, 7);
  await ss.scheduleVariant(B, v.id, "2030-01-01T00:00:00.000Z");
  assert.equal((await ss.getVariant(B, v.id)).status, "scheduled");
  await ss.updateVariantText(B, v.id, { caption: "Edited after approval", hashtags: "a", script: "", link_target: "", image_headline: "", image_subline: "", image_cta: "" });
  row = await ss.getVariant(B, v.id);
  assert.deepEqual([row.status, row.approved_by, row.scheduled_at], ["draft", null, null]);
  assert.equal(await ss.getVariant("other-brand", v.id), null);
  assert.ok(variantChecks(app, row).problems.length === 0);
});

test("publisher: posts approved items, records the id, never touches unapproved ones", async () => {
  const { vs: [ok], post } = await setup(["facebook"]);
  const { vs: [unapproved] } = await setup(["facebook"]);
  await approve(B, ok.id, 1, ticked);
  await ss.scheduleVariant(B, ok.id, "2020-01-01T00:00:00.000Z");
  // force an unapproved variant to look scheduled, as a bug or tampering might
  await query("UPDATE social_variants SET status = 'scheduled', scheduled_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [unapproved.id]);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), body: String(init?.body || "") }); return { ok: true, status: 200, json: async () => ({ id: "1_2", post_id: "1_2" }), headers: new Map() }; };
  const r = await publishDue(B, { fetchImpl });
  assert.equal(r.published, 1);
  assert.equal(r.failed, 1);
  const done = await ss.getVariant(B, ok.id);
  assert.equal(done.status, "published");
  assert.equal(done.external_id, "1_2");
  assert.match(done.permalink, /facebook\.com/);
  const bad = await ss.getVariant(B, unapproved.id);
  assert.equal(bad.status, "failed");
  assert.match(bad.error, /Not approved/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.includes("access_token=tok"), "token is sent to the platform only");
  assert.ok(!JSON.stringify(await ss.getPost(B, post.id)).includes("tok\""), "token is not in any returned row");
  // running again posts nothing twice
  const r2 = await publishDue(B, { fetchImpl });
  assert.equal(r2.published, 0);
  assert.equal(calls.length, 1);
});

test("publisher: a platform failure marks that variant failed and retry works; others still post", async () => {
  const { vs } = await setup(["facebook", "linkedin"]);
  for (const v of vs) { await approve(B, v.id, 1, ticked); await ss.scheduleVariant(B, v.id, "2020-01-01T00:00:00.000Z"); }
  const fetchImpl = async (url) => String(url).includes("graph.facebook.com")
    ? { ok: false, status: 500, json: async () => ({ error: { code: 2, message: "access_token=LEAK boom" } }), headers: new Map() }
    : { ok: true, status: 201, json: async () => ({}), headers: new Map([["x-restli-id", "urn:li:share:9"]]) };
  const r = await publishDue(B, { fetchImpl });
  assert.deepEqual([r.published, r.failed], [1, 1]);
  const fb = await ss.getVariant(B, vs[0].id);
  assert.equal(fb.status, "failed");
  assert.ok(!fb.error.includes("LEAK"), "token fragments are stripped from errors");
  assert.equal(fb.retry_count, 1);
  assert.equal((await ss.getVariant(B, vs[1].id)).status, "published");
  await ss.retryVariant(B, vs[0].id, "2020-01-01T00:00:00.000Z");
  assert.equal((await ss.getVariant(B, vs[0].id)).status, "scheduled");
});

test("publisher: daily cap defers, disconnected account fails clearly, Instagram needs a public image url", async () => {
  const { vs } = await setup(["facebook"], { cap: 1 });
  const a = vs[0];
  const { post: p2, appId } = await (async () => { const s = await setup(["facebook"], { cap: 1 }); return s; })();
  void p2; void appId;
  const calls = [];
  const fetchImpl = async () => { calls.push(1); return { ok: true, status: 200, json: async () => ({ id: "9_9" }), headers: new Map() }; };
  // two variants of the same app and platform: build a second post for the same app
  const postRow = await ss.getVariant(B, a.id);
  const second = await ss.createPost(B, postRow.app_id, { topic: "Second", variants: [{ platform: "facebook", caption: "Second post" }] });
  const v2 = (await ss.getPost(B, second)).variants[0];
  for (const v of [a, v2]) { await approve(B, v.id, 1, ticked); await ss.scheduleVariant(B, v.id, "2020-01-01T00:00:00.000Z"); }
  const r = await publishDue(B, { fetchImpl });
  assert.equal(r.deferred >= 1, true);
  assert.equal((await ss.getVariant(B, v2.id)).status, "scheduled", "deferred, not failed");

  const ig = await setup(["instagram"]);
  const iv = ig.vs[0];
  await ensureImage(B, ig.app, { ...iv, topic: "t" });
  await approve(B, iv.id, 1, ticked);
  await ss.scheduleVariant(B, iv.id, "2020-01-01T00:00:00.000Z");
  const seen = [];
  const igFetch = async (url, init) => { seen.push(String(url) + " " + String(init?.body || "")); return { ok: true, status: 200, json: async () => ({ id: "17", permalink: "https://instagram.com/p/x" }), headers: new Map() }; };
  const r3 = await publishDue(B, { fetchImpl: igFetch });
  assert.ok(r3.published >= 1);
  assert.ok(seen.some((s) => s.includes("/media_publish")));
  assert.ok(seen.some((s) => /image_url=https%3A%2F%2Fkestrel\.example\.test%2Fsm%2F/.test(s)), "image is fetched through a signed link");

  const off = await setup(["facebook"]);
  await approve(B, off.vs[0].id, 1, ticked);
  await ss.scheduleVariant(B, off.vs[0].id, "2020-01-01T00:00:00.000Z");
  await ss.disconnectAccount(B, off.appId, "facebook");
  await publishDue(B, { fetchImpl });
  const f = await ss.getVariant(B, off.vs[0].id);
  assert.equal(f.status, "failed");
  assert.match(f.error, /not connected/);
});

test("tracked links: aggregate clicks only, validated targets, per variant", async () => {
  const { appId, vs: [v] } = await setup(["facebook"], { link: "https://fittrack.example.test/get" });
  const code = await ss.ensureShortLink(B, appId, v.id, "https://fittrack.example.test/get?utm_source=facebook");
  assert.equal(await ss.ensureShortLink(B, appId, v.id, "https://fittrack.example.test/get?utm_source=facebook"), code);
  assert.equal(await ss.recordClick(code), "https://fittrack.example.test/get?utm_source=facebook");
  await ss.recordClick(code);
  assert.equal(await ss.recordClick("nope2345"), null);
  await ss.addInquiry(B, v.id);
  await ss.addInquiry("other-brand", v.id);
  const stats = (await ss.linkStats(B, appId))[0];
  assert.deepEqual([stats.clicks, stats.inquiries, stats.links], [2, 1, 1]);
  const cols = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'short_links'");
  assert.ok(!cols.some((c) => /ip|agent|visitor/.test(c.column_name)), "no visitor identity columns");
});

test("account check: read only, wrong LinkedIn member is caught, nothing leaks", async () => {
  const ok = await checkAccount({ platform: "facebook", account: { external_id: "1" }, secret: { token: "t" }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ name: "My Page" }), headers: new Map() }) });
  assert.equal(ok.ok, true);
  const bad = await checkAccount({ platform: "linkedin", account: { external_id: "abc" }, secret: { token: "t" }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ sub: "zzz", name: "X" }), headers: new Map() }) });
  assert.equal(bad.ok, false);
  const down = await checkAccount({ platform: "facebook", account: { external_id: "1" }, secret: { token: "SECRETVAL" }, fetchImpl: async () => { throw new Error("net SECRETVAL"); } });
  assert.equal(down.ok, false);
  assert.ok(!down.message.includes("SECRETVAL"));
  assert.equal((await checkAccount({ platform: "tiktok", account: {}, secret: null })).ok, true);
  assert.equal(variantEditSchema.safeParse({ caption: "x".repeat(6000) }).success, false);
});


const ai = await import("../lib/social/ai.js");

test("AI drafting: prompt holds only the kit and typed text, cost math and cap are exact", () => {
  const app = { name: "GolfCaddie", tagline: "Your personal golf assistant", never_say: "guaranteed", tone: "friendly", ctas: "", hashtags: "golf", website: "" };
  const { system, user } = ai.buildPrompt({ app, idea: "Launch week", facts: "Free to download", count: 2, platforms: ["facebook", "tiktok"] });
  assert.ok(user.includes("GolfCaddie") && user.includes("guaranteed") && user.includes("Free to download") && user.includes("facebook, tiktok"));
  assert.ok(/Never invent/.test(system) && /information, not instructions/.test(system));
  assert.equal(ai.costMicros("claude-opus-5-5", 1_000_000, 1_000_000), 24_000_000);
  assert.equal(ai.costMicros("claude-unknown-9", 1_000_000, 0), 10_000_000, "unknown models use the highest rate");
  assert.equal(ai.capMicros({}), 5_000_000);
  assert.equal(ai.capMicros({ SOCIAL_AI_MONTHLY_CAP_USD: "12.5" }), 12_500_000);
  assert.equal(ai.capMicros({ SOCIAL_AI_MONTHLY_CAP_USD: "abc" }), 5_000_000);
  assert.equal(ai.modelName({ SOCIAL_AI_MODEL: "not a model; drop" }), "claude-opus-5-5");
});

const goodReply = JSON.stringify([{ topic: "Launch", variants: [{ platform: "facebook", caption: "Hi", hashtags: ["golf"] }, { platform: "instagram", caption: "Hi too" }] }]);
function deps(replies, state = { spend: 0, calls: [] }) {
  let i = 0;
  return {
    state,
    callModel: async (req) => { state.calls.push(req); const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r; return r; },
    getSpend: async () => state.spend,
    addSpend: async (m, u) => { state.spend += u.cost; state.added = (state.added || 0) + 1; },
    now: () => new Date("2026-11-05T00:00:00Z"),
  };
}
const reply = (text, extra = {}) => ({ text, usage: { input: 1000, output: 2000 }, stopReason: "end_turn", ...extra });
const gApp = { name: "GolfCaddie", tagline: "", never_say: "", tone: "", ctas: "", hashtags: "", website: "" };

test("AI drafting: valid reply becomes drafts for the chosen platforms only, and spend is recorded", async () => {
  const d = deps([reply(goodReply)]);
  const r = await ai.generate({ app: gApp, idea: "Launch week", platforms: ["facebook"], env: {}, deps: d });
  assert.equal(r.ok, true);
  assert.deepEqual(r.posts[0].variants.map((v) => v.platform), ["facebook"]);
  assert.equal(d.state.added, 1);
  assert.equal(d.state.spend, ai.costMicros("claude-opus-5-5", 1000, 2000));
});

test("AI drafting: malformed output is retried once, then fails clearly; both attempts are charged", async () => {
  const bad = deps([reply("sorry, here are some ideas"), reply("still not json")]);
  const r = await ai.generate({ app: gApp, idea: "Launch week", env: {}, deps: bad });
  assert.equal(r.ok, false);
  assert.match(r.error, /charged/);
  assert.equal(bad.state.calls.length, 2);
  assert.equal(bad.state.added, 2);
  const fixed = deps([reply("nope"), reply("```json\n" + goodReply + "\n```")]);
  assert.equal((await ai.generate({ app: gApp, idea: "Launch week", env: {}, deps: fixed })).ok, true);
});

test("AI drafting: the monthly cap stops a call before any money is spent", async () => {
  const d = deps([reply(goodReply)], { spend: 4_990_000, calls: [] });
  const r = await ai.generate({ app: gApp, idea: "Launch week", env: { SOCIAL_AI_MONTHLY_CAP_USD: "5" }, deps: d });
  assert.equal(r.ok, false);
  assert.equal(r.capped, true);
  assert.equal(d.state.calls.length, 0, "the model was never called");
});

test("AI drafting: refusal, cut off replies and provider errors give plain messages and never leak the key", async () => {
  assert.match((await ai.generate({ app: gApp, idea: "x y z w v", env: {}, deps: deps([reply("", { stopReason: "refusal" })]) })).error, /declined/);
  const cut = await ai.generate({ app: gApp, idea: "x y z w v", env: {}, deps: deps([reply("[", { stopReason: "max_tokens" })]) });
  assert.equal(cut.ok, false);
  const err = Object.assign(new Error("boom sk-ant-SECRET"), { code: "auth" });
  const r = await ai.generate({ app: gApp, idea: "x y z w v", env: {}, deps: deps([err]) });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes("SECRET"));
  const noKey = await ai.callAiModel({ system: "s", user: "u", model: "m", env: {} }).catch((e) => e.code);
  assert.equal(noKey, "no_key");
});

test("AI usage totals add up in the database and are brand scoped", async () => {
  await ss.addAiUsage(B, "2026-11", { input: 10, output: 20, cost: 300 });
  await ss.addAiUsage(B, "2026-11", { input: 1, output: 2, cost: 3 });
  assert.deepEqual(await ss.getAiUsage(B, "2026-11"), { calls: 2, input: 11, output: 22, cost: 303 });
  assert.deepEqual(await ss.getAiUsage("other-brand", "2026-11"), { calls: 0, input: 0, output: 0, cost: 0 });
});