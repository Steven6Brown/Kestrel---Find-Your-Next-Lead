import test from "node:test";
import assert from "node:assert/strict";

process.env.PGLITE_DIR = "memory";
process.env.KESTREL_DATA_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "kestrel-test-"));
delete process.env.DATABASE_URL;
process.env.APP_SECRET = "test-secret-test-secret-123";
process.env.APP_BASE_URL = "https://concepts.example.test";
process.env.SENDER_NAME = "Test Sender";
process.env.SENDER_EMAIL = "sender@example.test";
process.env.MAILING_ADDRESS = "1 Test Street, Testville";
process.env.RESEND_API_KEY = "test-key";

const { classifyWebsite } = await import("../lib/sites.js");
const { normalizePlace, searchPlaces } = await import("../lib/places.js");
const store = await import("../lib/store.js");
const { runDiscovery, runAreaDiscovery } = await import("../lib/discovery.js");
const { buildDraft, sendProblems, resolveBody, sendViaResend } = await import("../lib/email.js");
const { getBrand } = await import("../config/brands.js");
const { verifyUnsubscribe, signUnsubscribe, mockupUrl } = await import("../lib/tokens.js");
const { categoryCopy, readableOn, telHref } = await import("../lib/mockupCopy.js");

const raw = (id, name, extra = {}) => ({
  id, displayName: { text: name }, formattedAddress: "1 Main St, Springfield, IL",
  addressComponents: [{ longText: "Springfield", types: ["locality"] }, { shortText: "IL", types: ["administrative_area_level_1"] }],
  nationalPhoneNumber: "(555) 010-0000", primaryType: "plumber", primaryTypeDisplayName: { text: "Plumber" },
  businessStatus: "OPERATIONAL", ...extra,
});

test("website classification", () => {
  assert.equal(classifyWebsite("").bucket, "no_website");
  assert.equal(classifyWebsite("https://www.facebook.com/x").kind, "social");
  assert.equal(classifyWebsite("https://acme-plumbing.com").bucket, "has_website");
});

test("normalizePlace rejects junk and fills fields", () => {
  assert.equal(normalizePlace({}), null);
  const p = normalizePlace(raw("abc", "Acme"));
  assert.equal(p.city, "Springfield");
  assert.equal(p.region, "IL");
  assert.equal(p.bucket, "no_website");
});

test("searchPlaces paginates and drops closed businesses", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ places: [raw(`p${calls}`, `B${calls}`), raw(`c${calls}`, "Gone", { businessStatus: "CLOSED_PERMANENTLY" })], nextPageToken: calls < 2 ? "t" : undefined }) };
  };
  const out = await searchPlaces({ apiKey: "k", textQuery: "x", maxPages: 3, fetchImpl });
  assert.equal(out.length, 2);
  assert.equal(calls, 2);
});

test("discovery dedupes on place id and splits buckets", async () => {
  const search = async () => [
    normalizePlace(raw("dup1", "No Site Co")),
    normalizePlace(raw("dup2", "Has Site Co", { websiteUri: "https://hassite.example" })),
  ];
  const a = await runDiscovery({ brandId: "aquila", locations: ["Springfield, IL"], categories: ["plumber"], search, apiKey: "k" });
  const b = await runDiscovery({ brandId: "aquila", locations: ["Springfield, IL"], categories: ["plumber"], search, apiKey: "k" });
  assert.equal(a.created, 2);
  assert.equal(b.created, 0);
  assert.equal((await store.listLeads("aquila", { bucket: "no_website" })).length, 1);
  assert.equal((await store.listLeads("aquila", { bucket: "has_website" })).length, 1);
});

test("leads are isolated per brand", async () => {
  await store.upsertPlace("other", normalizePlace(raw("dup1", "Other Brand Copy")));
  assert.equal((await store.listLeads("other")).length, 1);
  assert.equal((await store.listLeads("aquila")).length, 2);
});

test("discovery enforces the combo cap", async () => {
  const many = Array.from({ length: 21 }, (_, i) => `c${i}`);
  await assert.rejects(runDiscovery({ brandId: "aquila", locations: ["a b", "c d"], categories: many, search: async () => [], apiKey: "k" }));
});

test("email guardrails block unsafe sends and allow a complete one", async () => {
  const brand = getBrand("aquila");
  const lead = (await store.listLeads("aquila", { bucket: "no_website" }))[0];
  const { subject, body } = buildDraft({ lead, brand, mockupLink: mockupUrl(lead.mockup_token) });
  assert.ok(!/[–—]/.test(body), "no dash punctuation");
  assert.ok(body.includes(brand.mailingAddress));
  await store.saveDraft("aquila", lead.id, { subject, body });
  let draft = await store.getDraftByLead("aquila", lead.id);
  assert.ok((await sendProblems({ lead, draft, brand, sentToday: 0 })).some((p) => /approved/.test(p)));
  await store.setDraftStatus("aquila", lead.id, "approved");
  draft = await store.getDraftByLead("aquila", lead.id);
  assert.ok((await sendProblems({ lead, draft, brand, sentToday: 0 })).some((p) => /recipient/.test(p)));
  await store.updateLeadContact("aquila", lead.id, { contact_email: "owner@example.test", notes: "", status: "new" });
  const ready = await store.getLead("aquila", lead.id);
  assert.deepEqual(await sendProblems({ lead: ready, draft, brand, sentToday: 0 }), []);
  assert.ok((await sendProblems({ lead: ready, draft, brand, sentToday: 10 })).some((p) => /cap/.test(p)));
  await store.addSuppression("aquila", "owner@example.test");
  const after = await store.getLead("aquila", lead.id);
  assert.equal(after.status, "do_not_contact");
  assert.ok((await sendProblems({ lead: after, draft: await store.getDraftByLead("aquila", lead.id), brand, sentToday: 0 })).length > 0);
  assert.equal((await store.stats("aquila")).optOuts, 1);
});

test("unsubscribe tokens are bound to the address", () => {
  const sig = signUnsubscribe("aquila", "A@x.test");
  assert.ok(verifyUnsubscribe("aquila", "a@x.test", sig));
  assert.ok(!verifyUnsubscribe("aquila", "b@x.test", sig));
  assert.ok(!verifyUnsubscribe("aquila", "a@x.test", "bad"));
});

test("send includes opt-out headers and resolved link", async () => {
  let sent;
  const brand = getBrand("aquila");
  await sendViaResend({
    brand, to: "r@x.test", subject: "S", body: "Hello\n{{UNSUBSCRIBE_URL}}", apiKey: "k",
    fetchImpl: async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ id: "1" }) }; },
  });
  assert.ok(sent.headers["List-Unsubscribe"].includes("/api/unsubscribe?"));
  assert.equal(sent.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(!sent.text.includes("{{"));
  assert.ok(resolveBody("{{UNSUBSCRIBE_URL}}", { brand, email: "r@x.test" }).includes("/unsubscribe?"));
});

test("mockup helpers", () => {
  assert.equal(categoryCopy({ name: "A", category: "plumber" }).kind, "trade");
  assert.equal(categoryCopy({ name: "A", category: "zzz" }).kind, "local");
  assert.equal(telHref("(555) 010-0000"), "tel:5550100000");
  assert.equal(telHref("javascript:alert(1)"), "");
  assert.equal(readableOn("#0f6b63"), "#ffffff");
  assert.equal(readableOn("#ffff00"), "#111111");
  const copy = JSON.stringify(categoryCopy({ name: "A", category: "restaurant" }));
  assert.ok(!/[–—]|lorem/i.test(copy));
});

test("openstreetmap source: category map, geocode, query, normalize", async () => {
  process.env.OSM_CONTACT = "me@example.test";
  const osm = await import("../lib/overpass.js");
  assert.equal(osm.resolveCategory("Plumbers").key, "plumber");
  assert.equal(osm.resolveCategory("space tourism"), null);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(osm.NOMINATIM)) return { ok: true, json: async () => [{ osm_type: "relation", osm_id: 123, name: "Testville" }] };
    return { ok: true, json: async () => ({ elements: [
      { type: "node", id: 1, tags: { name: "Pipe Co", phone: "555 0100", "addr:street": "Main St", "addr:housenumber": "5" } },
      { type: "node", id: 2, tags: { name: "Has Site", website: "https://hassite.example" } },
      { type: "way", id: 3, tags: { name: "FB Only", "contact:facebook": "https://facebook.com/fbonly" } },
      { type: "node", id: 4, tags: { amenity: "x" } },
    ] }) };
  };
  const out = await osm.searchOverpass({ location: "Testville, TS", category: "plumber", fetchImpl });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.bucket), ["no_website", "has_website", "no_website"]);
  assert.equal(out[2].website_kind, "social");
  assert.equal(out[0].place_id, "osm:node/1");
  assert.equal(out[0].city, "Testville");
  const body = decodeURIComponent(calls[1].init.body);
  assert.ok(body.includes("area(3600000123)") && body.includes('["craft"="plumber"]'));
  assert.ok(calls.every((c) => c.init.headers["User-Agent"].includes("me@example.test")));
  await assert.rejects(osm.searchOverpass({ location: "x y", category: "nope", fetchImpl }), /not a supported/);
});

test("osm leads flow through discovery and dedupe", async () => {
  const osm = await import("../lib/overpass.js");
  const fetchImpl = async (url) => String(url).startsWith(osm.NOMINATIM)
    ? { ok: true, json: async () => [{ osm_type: "relation", osm_id: 9, name: "Zed" }] }
    : { ok: true, json: async () => ({ elements: [{ type: "node", id: 77, tags: { name: "Zed Plumbing" } }] }) };
  const search = (a) => osm.searchOverpass({ ...a, fetchImpl });
  const r1 = await runDiscovery({ brandId: "aquila", locations: ["Zed, ZZ"], categories: ["plumber"], search });
  const r2 = await runDiscovery({ brandId: "aquila", locations: ["Zed, ZZ"], categories: ["plumber"], search });
  assert.equal(r1.created, 1);
  assert.equal(r2.created, 0);
});

test("osm duplicate entries do not become false no-website leads", async () => {
  const { mergeDuplicates } = await import("../lib/overpass.js");
  const out = mergeDuplicates([
    { name: "Salon Beautiful", bucket: "no_website" },
    { name: "salon  beautiful", bucket: "has_website" },
    { name: "Other Shop", bucket: "no_website" },
  ]);
  assert.deepEqual(out.map((p) => p.name), ["salon  beautiful", "Other Shop"]);
});

test("campaign validation only accepts picks from the fixed lists", async () => {
  const c = await import("../lib/campaigns.js");
  const { CATEGORIES } = await import("../lib/overpass.js");
  const grouped = c.CATEGORY_GROUPS.flatMap(([, k]) => k).sort();
  assert.deepEqual(grouped, Object.keys(CATEGORIES).sort());
  assert.equal(c.STATES.length, 51);
  assert.ok(c.validateCampaign({ categories: ["plumber"], locations: ["State College, PA"], frequency: "daily", run_time: "06:00" }).ok);
  for (const bad of [
    { categories: [], locations: ["A B, PA"] },
    { categories: ["plumber"], locations: [] },
    { categories: ["__proto__"], locations: ["State College, PA"] },
    { categories: ["plumber"], locations: ["x\"]; drop, PA"] },
    { categories: ["plumber"], locations: ["Nowhere, ZZ"] },
    { categories: Object.keys(CATEGORIES).slice(0, 9), locations: ["State College, PA"] },
    { categories: Object.keys(CATEGORIES).slice(0, 8), locations: Array.from({ length: 6 }, (_, i) => `Town ${i}, PA`) },
  ]) assert.equal(c.validateCampaign(bad).ok, false);
  assert.equal(c.validateCampaign({ categories: ["plumber"], locations: ["State College, PA"], frequency: "x", run_time: "x" }).value.frequency, "manual");
  const bs = String.fromCharCode(92);
  assert.equal(c.registerCommand(3, "weekdays", "06:00"), `.${bs}scripts${bs}register-task.ps1 -CampaignId 3 -Schedule Weekdays -Time 06:00`);
  assert.equal(c.registerCommand(3, "manual", "06:00"), null);
  const from = new Date(2026, 10, 6, 7, 0); // a Friday, 7 AM
  assert.equal(c.nextRun("weekdays", "06:00", from).getDay(), 1);
  assert.equal(c.nextRun("daily", "06:00", from).getDate(), 7);
  assert.equal(c.nextRun("manual", "06:00", from), null);
});

test("campaign run records history and blocks a double start", async () => {
  const { startRun } = await import("../lib/runner.js");
  const id = await store.createCampaign("aquila", { name: "T", categories: ["plumber"], locations: ["Zed, ZZ"], frequency: "daily", run_time: "06:00" });
  const campaign = await store.getCampaign("aquila", id);
  assert.deepEqual(campaign.categories, ["plumber"]);
  let release;
  const gate = new Promise((r) => { release = r; });
  const discover = async () => { await gate; return { searches: 1, found: 5, created: 3, noWebsite: 2, hasWebsite: 3, errors: [] }; };
  const r1 = await startRun({ brandId: "aquila", campaign, trigger: "schedule", discover });
  const r2 = await startRun({ brandId: "aquila", campaign, trigger: "schedule", discover });
  assert.ok(r2.skipped);
  release();
  await r1.done;
  const [run] = await store.listRuns("aquila", { campaignId: id });
  assert.equal(run.status, "done");
  assert.equal(run.created, 3);
  const failed = await startRun({ brandId: "aquila", campaign, discover: async () => { throw new Error("boom"); } });
  await failed.done;
  assert.equal((await store.listRuns("aquila", { campaignId: id }))[0].status, "error");
});

test("state city list ranks by population and dedupes", async () => {
  const { rankCities } = await import("../lib/geo.js");
  const out = rankCities([
    { tags: { name: "Small", population: "100" } }, { tags: { name: "Big", population: "5000" } },
    { tags: { name: "big", population: "5000" } }, { tags: { name: "NoPop" } }, { tags: {} },
  ]);
  assert.deepEqual(out.map((c) => c.name), ["Big", "Small", "NoPop"]);
});

test("overpass retries busy servers across mirrors, then gives a clear error", async () => {
  const { overpassRequest, OVERPASS_MIRRORS } = await import("../lib/overpass.js");
  const urls = [];
  const flaky = async (url) => { urls.push(url); return urls.length < 3 ? { ok: false, status: 502 } : { ok: true, json: async () => ({ elements: [] }) }; };
  const out = await overpassRequest("x", { fetchImpl: flaky, pace: false, retryDelayMs: 0 });
  assert.deepEqual(out, { elements: [] });
  assert.equal(urls[0], OVERPASS_MIRRORS[0]);
  assert.equal(urls[1], OVERPASS_MIRRORS[1]);
  await assert.rejects(overpassRequest("x", { fetchImpl: async () => ({ ok: false, status: 504 }), pace: false, retryDelayMs: 0 }), /busy/);
  await assert.rejects(overpassRequest("x", { fetchImpl: async () => ({ ok: false, status: 400 }), pace: false, retryDelayMs: 0 }), /Overpass error 400/);
});

test("openstreetmap leads need a human website check before drafting", async () => {
  const osmLead = (await store.listLeads("aquila")).find((l) => l.place_id.startsWith("osm:") && l.bucket === "no_website");
  assert.ok(osmLead);
  assert.equal(store.outreachReady(osmLead), false);
  let needing = await store.leadsNeedingDraft("aquila");
  assert.ok(!needing.some((l) => l.id === osmLead.id), "unchecked OSM lead is not drafted in bulk");
  await store.setSiteCheck("aquila", osmLead.id, "confirmed_none");
  const checked = await store.getLead("aquila", osmLead.id);
  assert.equal(store.outreachReady(checked), true);
  needing = await store.leadsNeedingDraft("aquila");
  assert.ok(needing.some((l) => l.id === osmLead.id));
  // a human verdict survives a re-scan that still reports no website
  await store.upsertPlace("aquila", { ...osmLead, website: "", website_kind: "none", bucket: "no_website" });
  await store.setSiteCheck("aquila", osmLead.id, "has_site");
  await store.upsertPlace("aquila", { ...osmLead, bucket: "no_website" });
  assert.equal((await store.getLead("aquila", osmLead.id)).bucket, "has_website");
});

// ---------------- authentication ----------------

test("passwords: hash and verify, policy, breach check (k-anonymity)", async () => {
  const pw = await import("../lib/passwords.js");
  const h = await pw.hashPassword("correct horse battery staple");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await pw.verifyPassword("correct horse battery staple", h), true);
  assert.equal(await pw.verifyPassword("wrong horse battery staple", h), false);
  assert.equal(await pw.verifyPassword("x", "garbage"), false);
  assert.notEqual(h, await pw.hashPassword("correct horse battery staple"), "salted");
  assert.ok(pw.passwordProblems("short").length > 0);
  assert.ok(pw.passwordProblems("Password12345!").some((p) => /common/.test(p)));
  assert.ok(pw.passwordProblems("steven-is-great-2026", { email: "steven@x.test" }).some((p) => /email/.test(p)));
  assert.deepEqual(pw.passwordProblems("violet-lantern-kettle-91"), []);
  let asked;
  const sha1 = (await import("node:crypto")).createHash("sha1").update("hunter2hunter2").digest("hex").toUpperCase();
  const fetchImpl = async (url) => { asked = url; return { ok: true, text: async () => `${sha1.slice(5)}:42\nAAAAA:1` }; };
  assert.equal(await pw.isBreached("hunter2hunter2", { fetchImpl, env: {} }), true);
  assert.ok(asked.endsWith(sha1.slice(0, 5)) && !asked.includes(sha1.slice(5)), "only the 5 character prefix is sent");
  assert.equal(await pw.isBreached("hunter2hunter2", { fetchImpl: async () => { throw new Error("offline"); }, env: {} }), false, "fails open");
  assert.equal(await pw.isBreached("hunter2hunter2", { fetchImpl, env: { AUTH_CHECK_BREACHED: "0" } }), false);
});

test("totp matches the RFC 6238 test vector and rejects replays", async () => {
  const t = await import("../lib/totp.js");
  const secret = t.base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(t.hotp(secret, Math.floor(59 / 30)), "287082"); // RFC 6238 appendix B, T=59, 6 digits
  assert.equal(t.hotp(secret, Math.floor(1111111109 / 30)), "081804");
  const time = 1111111109 * 1000;
  const step = t.verifyTotp(secret, "081804", { time });
  assert.equal(step, Math.floor(1111111109 / 30));
  assert.equal(t.verifyTotp(secret, "081804", { time, lastStep: step }), null, "a used code cannot be replayed");
  assert.equal(t.verifyTotp(secret, "000000", { time }), null);
  assert.equal(t.verifyTotp(secret, "abc", { time }), null);
  assert.deepEqual(t.base32Decode(t.base32Encode(Buffer.from("hello"))), Buffer.from("hello"));
  const codes = t.newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.equal(t.hashRecovery(codes[0]), t.hashRecovery(codes[0].toUpperCase().replace("-", " ")));
});

test("secrets at rest round trip and tamper detection", async () => {
  const c = await import("../lib/crypto.js");
  const blob = c.encrypt("JBSWY3DPEHPK3PXP");
  assert.equal(c.decrypt(blob), "JBSWY3DPEHPK3PXP");
  assert.throws(() => c.decrypt(blob.slice(0, -3) + "AAA"));
});

test("accounts: lockout, sessions, expiry, one-time tokens, last owner", async () => {
  const u = await import("../lib/users.js");
  const id = await u.createUser("aquila", { email: " Owner@Example.test ", name: "Owner", passwordHash: "x", role: "owner", verified: true });
  const user = await u.getUserByEmail("aquila", "owner@example.test");
  assert.equal(user.id, id);
  assert.equal(await u.activeOwnerCount("aquila"), 1);
  // lockout after repeated failures
  for (let i = 0; i < u.LOCKOUT_AFTER - 1; i++) assert.equal((await u.recordFailure(id)).locked, false);
  assert.equal((await u.recordFailure(id)).locked, true);
  assert.equal(u.isLocked(await u.getUser("aquila", id)), true);
  await u.recordSuccess(id);
  assert.equal(u.isLocked(await u.getUser("aquila", id)), false);
  // sessions store only a hash, expire, and die with the user
  const raw = await u.createSession(id, { mfaPassed: true });
  const s = await u.getSession(raw);
  assert.equal(s.email, "owner@example.test");
  const { query } = await import("../lib/db.js");
  const [row] = await query("SELECT token_hash FROM sessions");
  assert.notEqual(row.token_hash, raw);
  await query("UPDATE sessions SET last_seen_at = ?", [new Date(Date.now() - 9 * 3600 * 1000).toISOString()]);
  assert.equal(await u.getSession(raw), null, "idle timeout");
  const raw2 = await u.createSession(id, { remember: true });
  assert.ok(await u.getSession(raw2));
  await u.setStatus(id, "disabled");
  assert.equal(await u.getSession(raw2), null, "disabled users lose access immediately");
  await u.setStatus(id, "active");
  // one-time tokens
  const t1 = await u.createAuthToken(id, "reset", u.RESET_TTL_MS);
  assert.ok(await u.peekAuthToken(t1, "reset"));
  assert.equal(await u.peekAuthToken(t1, "invite"), null, "kind must match");
  const t2 = await u.createAuthToken(id, "reset", u.RESET_TTL_MS);
  assert.equal(await u.peekAuthToken(t1, "reset"), null, "a newer link voids the older one");
  assert.ok(await u.consumeAuthToken(t2, "reset"));
  assert.equal(await u.consumeAuthToken(t2, "reset"), null, "single use");
  const t3 = await u.createAuthToken(id, "reset", -1000);
  assert.equal(await u.consumeAuthToken(t3, "reset"), null, "expired");
  // audit trail
  await u.audit("aquila", id, "login_ok", "test", "1.2.3.4");
  assert.equal((await u.listAudit("aquila"))[0].event, "login_ok");
});

test("mail goes to a local outbox when email is not configured", async () => {
  const m = await import("../lib/mailer.js");
  assert.equal(m.mailConfigured({}), false);
  assert.equal(m.mailConfigured({ RESEND_API_KEY: "k", SENDER_EMAIL: "a@b.test" }), true);
  assert.deepEqual(await m.sendAccountMail({ to: "a@b.test", subject: "s", text: "t" }, { env: { VERCEL: "1" } }), { delivered: false, via: "none" });
  let body;
  const r = await m.sendAccountMail({ to: "a@b.test", subject: "s", text: "t" }, {
    env: { RESEND_API_KEY: "k", SENDER_EMAIL: "from@b.test" },
    fetchImpl: async (_u, init) => { body = JSON.parse(init.body); return { ok: true }; },
  });
  assert.equal(r.delivered, true);
  assert.deepEqual(body.to, ["a@b.test"]);
});

test("post-login redirects are same-site only", async () => {
  const { safeNext } = await import("../lib/safeNext.js");
  assert.equal(safeNext("/leads?bucket=no_website"), "/leads?bucket=no_website");
  for (const bad of ["https://evil.test", "//evil.test", "/" + String.fromCharCode(92) + "evil.test", "javascript:alert(1)", "", null, "/login", "/reset?token=x"]) {
    assert.equal(safeNext(bad), "/");
  }
});

test("a damaged local database folder is moved aside and replaced, not deleted", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openLocal } = await import("../lib/db.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-db-"));
  const dir = path.join(root, "pglite");
  fs.mkdirSync(path.join(dir, "base", "1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "global"), { recursive: true });
  fs.writeFileSync(path.join(dir, "PG_VERSION"), "16");
  fs.writeFileSync(path.join(dir, "global", "pg_control"), "junk");
  const db = await openLocal(dir);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM leads")).rows[0].n, 0);
  assert.ok(fs.readdirSync(root).some((n) => n.startsWith("pglite.broken-")), "old folder kept");
  await db.close();
});

test("a scan reports progress, gives up when servers keep failing, and respects its time limit", async () => {
  const seen = [];
  const ok = async () => [];
  const a = await runDiscovery({ brandId: "aquila", locations: ["A B, PA", "C D, PA"], categories: ["plumber", "barber"], search: ok, apiKey: "k", onProgress: (p) => seen.push(p.attempted) });
  assert.equal(a.attempted, 4);
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  assert.equal(a.stopped, null);
  const fail = async () => { throw new Error("busy"); };
  const b = await runDiscovery({ brandId: "aquila", locations: ["A B, PA", "C D, PA"], categories: ["plumber", "barber", "dentist"], search: fail, apiKey: "k" });
  assert.equal(b.attempted, 3, "stops after 3 failures in a row instead of grinding through all 6");
  assert.match(b.stopped, /in a row failed/);
  const c = await runDiscovery({ brandId: "aquila", locations: ["A B, PA"], categories: ["plumber"], search: ok, apiKey: "k", deadlineMs: -1 });
  assert.equal(c.attempted, 0);
  assert.match(c.stopped, /minute limit/);
});

test("local files live outside the project folder (OneDrive safe)", async () => {
  const { appDataDir } = await import("../lib/appdir.js");
  const dir = appDataDir();
  const path = await import("node:path");
  assert.ok(!path.resolve(dir).startsWith(path.resolve(process.cwd())), dir);
  assert.equal(appDataDir.length, 0);
});

test("an unclean stop (stale lock) does not lose the database", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openLocal } = await import("../lib/db.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-stale-"));
  const live = path.join(root, "live", "pglite");
  const a = await openLocal(live);
  await a.exec("INSERT INTO suppressions (brand_id, email, reason, created_at) VALUES ('aquila','keep@x.test','t','now')");
  // Simulate a hard kill: copy the folder while it is open, so it still contains postmaster.pid.
  const crashed = path.join(root, "crashed", "pglite");
  fs.mkdirSync(path.dirname(crashed), { recursive: true });
  fs.cpSync(live, crashed, { recursive: true });
  assert.ok(fs.existsSync(path.join(crashed, "postmaster.pid")), "the stale lock is present");
  await a.close();
  const b = await openLocal(crashed);
  assert.equal((await b.query("SELECT email FROM suppressions")).rows[0].email, "keep@x.test", "data survived");
  assert.ok(!fs.readdirSync(path.dirname(crashed)).some((n) => n.includes(".broken-")), "nothing was moved aside");
  await b.close();
});

test("a second live copy of the app is refused instead of corrupting the database", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openLocal } = await import("../lib/db.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-lock-"));
  const dir = path.join(root, "pglite");
  fs.writeFileSync(dir + ".lock", String(process.ppid)); // a live process that is not us
  await assert.rejects(openLocal(dir), /Another copy of Kestrel/);
  fs.writeFileSync(dir + ".lock", "999999999"); // a dead process: stale, so it is taken over
  const db = await openLocal(dir);
  assert.equal((await db.query("SELECT 1 AS x")).rows[0].x, 1);
  await db.close();
});

test("data from the old in-project folder is moved to the app data folder", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { migrateLegacyData } = await import("../lib/appdir.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-mig-"));
  const legacy = path.join(root, "old");
  fs.mkdirSync(path.join(legacy, "pglite"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "pglite", "PG_VERSION"), "16");
  fs.writeFileSync(path.join(legacy, "pglite", "postmaster.pid"), "-42");
  fs.writeFileSync(path.join(legacy, ".secret"), "old-secret");
  const target = path.join(root, "new");
  assert.equal(migrateLegacyData({ legacyRoot: legacy, newRoot: target }), true);
  assert.ok(fs.existsSync(path.join(target, "pglite", "PG_VERSION")));
  assert.ok(!fs.existsSync(path.join(target, "pglite", "postmaster.pid")), "stale lock dropped");
  assert.equal(fs.readFileSync(path.join(target, ".secret"), "utf8"), "old-secret");
  assert.ok(fs.existsSync(path.join(legacy, "pglite", "PG_VERSION")), "original kept as a backup");
  assert.equal(migrateLegacyData({ legacyRoot: legacy, newRoot: target }), false, "never overwrites");
});

test("a scan cut off by stopping the app is closed out on the next start", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-run-"));
  const { openLocal } = await import("../lib/db.js");
  const dir = path.join(root, "pglite");
  const first = await openLocal(dir);
  await first.exec("INSERT INTO runs (brand_id, campaign_id, campaign_name, started_at) VALUES ('aquila', 1, 'cut off', 'now')");
  await first.close();
  const prev = process.env.PGLITE_DIR;
  process.env.PGLITE_DIR = dir;
  delete globalThis.__kestrelDb;
  const { query } = await import("../lib/db.js");
  const [run] = await query("SELECT status, error FROM runs WHERE campaign_name = 'cut off'");
  assert.equal(run.status, "interrupted");
  assert.match(run.error, /stopped/);
  process.env.PGLITE_DIR = prev;
  delete globalThis.__kestrelDb;
});

// ---------------- area campaigns and the leads database ----------------

test("area scanning helpers: categories from tags, queries, no business type needed", async () => {
  const o = await import("../lib/overpass.js");
  assert.equal(o.categoryFromTags({ shop: "hairdresser", amenity: "x" }), "hairdresser");
  assert.equal(o.categoryFromTags({ amenity: "fast_food" }), "fast_food");
  assert.equal(o.categoryFromTags({ shop: "yes" }), "");
  assert.equal(o.categoryLabel("fast_food"), "Fast Food");
  const p = o.normalizeElement({ type: "node", id: 9, tags: { name: "Joe's", amenity: "fast_food", website: "https://joes.example" } }, { cityFallback: "Erie" });
  assert.equal(p.category, "fast_food");
  assert.equal(p.category_label, "Fast Food");
  assert.equal(p.bucket, "has_website");
  const q = o.buildAreaQuery(o.AREA_FAMILIES.shops, { area: 3600000123 });
  assert.ok(q.includes("area(3600000123)") && q.includes('nwr["shop"]["name"](area.a)'));
  assert.ok(Object.keys(o.AREA_FAMILIES).length >= 6);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith(o.NOMINATIM)) return { ok: true, json: async () => [{ osm_type: "relation", osm_id: 5, name: "Erie" }] };
    return { ok: true, json: async () => ({ elements: [{ type: "node", id: 1, tags: { name: "A Shop", shop: "bakery" } }, { type: "node", id: 2, tags: { name: "A Shop", shop: "bakery", website: "https://a.example" } }] }) };
  };
  const places = await o.searchArea({ location: "Erie, PA", family: "shops", fetchImpl });
  assert.equal(places.length, 1, "website-less twin merged away");
  assert.throws(() => { throw new Error("x"); });
  await assert.rejects(o.searchArea({ location: "Erie, PA", family: "nope", fetchImpl }), /Unknown business family/);
});

test("area campaigns validate cities only and resume instead of repeating work", async () => {
  const c = await import("../lib/campaigns.js");
  assert.ok(c.validateAreaCampaign({ locations: ["Erie, PA"], frequency: "daily", run_time: "06:00" }).ok);
  assert.deepEqual(c.validateAreaCampaign({ locations: ["Erie, PA"] }).value.categories, ["all"]);
  assert.equal(c.validateAreaCampaign({ locations: [] }).ok, false);
  assert.equal(c.validateAreaCampaign({ locations: ["Nowhere, ZZ"] }).ok, false);
  assert.equal(c.validateAreaCampaign({ locations: Array.from({ length: 26 }, (_, i) => "Town " + i + ", PA") }).ok, false);
  assert.equal(c.areaCampaignName(["Erie, PA", "Akron, OH"]), "All businesses in Erie, PA +1");

  const id = await store.createCampaign("aquila", { name: "Area", categories: ["all"], locations: ["Erie, PA", "Akron, OH"], frequency: "manual", run_time: "06:00" });
  const seen = [];
  let n = 100;
  const search = async ({ location, family }) => {
    seen.push(location + "|" + family);
    n++;
    return [{ place_id: "g:" + n, name: "Biz " + n, category: "bakery", category_label: "Bakery", address: "", city: location.split(",")[0], region: "XX", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }];
  };
  const first = await runAreaDiscovery({ brandId: "aquila", campaignId: id, locations: ["Erie, PA", "Akron, OH"], search, deadlineMs: -1 });
  assert.equal(seen.length, 0);
  assert.match(first.stopped, /minute limit/);
  assert.equal(first.total, 12);
  const second = await runAreaDiscovery({ brandId: "aquila", campaignId: id, locations: ["Erie, PA", "Akron, OH"], search });
  assert.equal(seen.length, 12, "two cities x six families");
  assert.equal(second.attempted, 12);
  const third = await runAreaDiscovery({ brandId: "aquila", campaignId: id, locations: ["Erie, PA", "Akron, OH"], search });
  assert.equal(seen.length, 12, "everything was scanned this week, so nothing repeats");
  assert.equal(third.attempted, 12);
  // a run that fails partway keeps what finished and picks up the rest later
  const id2 = await store.createCampaign("aquila", { name: "Area2", categories: ["all"], locations: ["Mercer, PA"], frequency: "manual", run_time: "06:00" });
  let calls = 0;
  const flaky = async (a) => { calls++; if (calls <= 2) throw new Error("busy"); return search(a); };
  const r1 = await runAreaDiscovery({ brandId: "aquila", campaignId: id2, locations: ["Mercer, PA"], search: flaky });
  assert.equal(r1.errors.length, 2);
  assert.equal(r1.searches, 4);
  const r2 = await runAreaDiscovery({ brandId: "aquila", campaignId: id2, locations: ["Mercer, PA"], search: async (a) => search(a) });
  assert.equal(r2.attempted, 6);
  assert.equal(r2.searches, 2, "only the two failed parts were retried");
  const { isAreaCampaign } = await import("../lib/runner.js");
  assert.equal(isAreaCampaign({ categories: ["all"] }), true);
  assert.equal(isAreaCampaign({ categories: ["plumber"] }), false);
});

test("leads database filters, facets, drafts-in-filter, and CSV are safe and correct", async () => {
  const lf = await import("../lib/leadfilters.js");
  const d = lf.parseFilters({});
  assert.equal(d.site, "none");
  assert.equal(lf.parseFilters({ site: "drop table" }).site, "none", "unknown values fall back");
  assert.equal(lf.parseFilters({ category: "bad value;" }).category, "");
  const evil = lf.parseFilters({ city: "x'; DROP TABLE leads;--" });
  const w = lf.buildWhere("aquila", evil);
  assert.ok(!w.where.includes("DROP"), "never interpolated");
  assert.ok(w.args.includes("x'; DROP TABLE leads;--"), "passed as a parameter");
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({}), { site: "has", category: "bakery" }), "/leads?site=has&category=bakery");
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({ site: "none" }), {}), "/leads");
  assert.equal(lf.csvCell('=cmd|"x"'), "\"'=cmd|\"\"x\"\"\"");
  assert.equal(lf.csvCell(null), '""');

  const all = lf.parseFilters({ site: "any" });
  const total = await store.countLeadsFiltered("aquila", all);
  assert.ok(total > 10);
  const none = lf.parseFilters({ site: "none" });
  const has = lf.parseFilters({ site: "has" });
  const nNone = await store.countLeadsFiltered("aquila", none);
  const nHas = await store.countLeadsFiltered("aquila", has);
  assert.equal(nNone + nHas, total, "every business is in exactly one bucket");
  const page = await store.searchLeads("aquila", none, { limit: 5, offset: 0 });
  assert.equal(page.length, 5);
  const facets = await store.leadFacets("aquila", all);
  assert.ok(facets.categories.some((c) => c.value === "bakery"));
  assert.ok(facets.cities.length >= 1);
  const bakery = lf.parseFilters({ site: "any", category: "bakery" });
  assert.equal(await store.countLeadsFiltered("aquila", bakery), facets.categories.find((c) => c.value === "bakery").n);
  // drafts in a filter respect the readiness gate: google style ids are ready, unchecked OSM ones are not
  const ready = await store.draftableInFilter("aquila", lf.parseFilters({ site: "none" }), 500);
  assert.ok(ready.every((x) => store.outreachReady(x)));
  assert.ok(ready.length > 0);
});

// ---------------- CRM: stages, timeline, tasks ----------------

test("crm date helpers and stage rules", async () => {
  const c = await import("../lib/crm.js");
  assert.equal(c.todayStr(new Date(2026, 10, 5, 23, 59)), "2026-11-05");
  assert.equal(c.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(c.addDays("2026-03-08", 1), "2026-03-09", "across a DST change");
  assert.equal(c.addDays("2026-01-31", 30), "2026-03-02");
  assert.equal(c.dueLabel("2026-11-04", "2026-11-05"), "Overdue since 2026-11-04");
  assert.equal(c.dueLabel("2026-11-05", "2026-11-05"), "Due today");
  assert.equal(c.dueLabel("2026-11-06", "2026-11-05"), "Due tomorrow");
  assert.equal(c.isDateStr("2026-02-30x"), false);
  assert.equal(c.statusForStage("replied", "new"), "contacted");
  assert.equal(c.statusForStage("replied", "skipped"), "skipped");
  assert.equal(c.statusForStage("not_interested", "new"), "do_not_contact");
  assert.equal(c.STAGE_KEYS.length, 8);
});

test("contacts: manual add, timeline is append only, stage changes are logged", async () => {
  const id = await store.createContact("aquila", { name: "Pat Referral", email: "Pat@Example.test", phone: "(555) 010-0199", source: "referral", notes: "met at the seminar" });
  const lead = await store.getLead("aquila", id);
  assert.equal(lead.place_id, null, "manual contacts need no place id");
  assert.equal(lead.bucket, "unknown");
  assert.equal(lead.source, "referral");
  assert.equal(lead.stage, "new");
  assert.equal((await store.findLeadByEmail("aquila", "pat@example.test")).id, id, "email lookup ignores case");
  await store.addActivity("aquila", id, { kind: "call", body: "Called, left a voicemail" });
  await assert.rejects(store.addActivity("aquila", id, { kind: "bogus", body: "x" }), /Unknown activity kind/);
  const r = await store.setStage("aquila", id, "replied");
  assert.equal(r.changed, true);
  assert.equal((await store.setStage("aquila", id, "replied")).changed, false, "no duplicate timeline entry");
  const after = await store.getLead("aquila", id);
  assert.equal(after.stage, "replied");
  assert.equal(after.status, "contacted", "older status field stays in step");
  const log = await store.listActivities("aquila", id);
  assert.deepEqual(log.map((a) => a.kind), ["stage_change", "call", "system"]);
  assert.match(log[0].body, /New to Replied/);
  await assert.rejects(store.setStage("aquila", id, "nonsense"), /Unknown stage/);
});

test("not interested means do not contact: suppression, no pending drafts, timeline", async () => {
  const id = await store.createContact("aquila", { name: "Stop Me", email: "stop@example.test", source: "manual" });
  await store.saveDraft("aquila", id, { subject: "Hello there", body: "A long enough body for the draft to save properly." });
  await store.setStage("aquila", id, "not_interested");
  const lead = await store.getLead("aquila", id);
  assert.equal(lead.status, "do_not_contact");
  assert.equal(await store.isSuppressed("aquila", "stop@example.test"), true);
  assert.equal((await store.getDraftByLead("aquila", id)).status, "rejected");
  assert.ok((await store.listActivities("aquila", id)).some((a) => a.kind === "stage_change" && /Not interested/.test(a.body)));
  // the reverse path: an unsubscribe link click also moves the stage
  const id2 = await store.createContact("aquila", { name: "Click Unsub", email: "click@example.test", source: "manual" });
  await store.addSuppression("aquila", "click@example.test", "unsubscribe link");
  assert.equal((await store.getLead("aquila", id2)).stage, "not_interested");
});

test("sending an approved draft moves the contact to contacted and logs it", async () => {
  const id = await store.createContact("aquila", { name: "Send Target", email: "send@example.test", source: "inbound" });
  await store.saveDraft("aquila", id, { subject: "Hello there", body: "A long enough body for the draft to save properly." });
  await store.markDraftSent("aquila", id, { to: "send@example.test", resendId: "r1" });
  assert.equal((await store.getLead("aquila", id)).stage, "contacted");
  assert.ok((await store.listActivities("aquila", id)).some((a) => a.kind === "email_out" && /send@example.test/.test(a.body)));
});

test("tasks: Today groups, snooze, done, and who needs a follow-up", async () => {
  const c = await import("../lib/crm.js");
  const today = c.todayStr();
  const id = await store.createContact("aquila", { name: "Task Person", source: "manual" });
  await store.setStage("aquila", id, "proposal_sent");
  assert.ok((await store.needsFollowUp("aquila")).some((x) => x.id === id), "mid-conversation with no task");
  const overdue = await store.addTask("aquila", id, { title: "Chase the proposal", dueOn: c.addDays(today, -2) });
  const due = await store.addTask("aquila", id, { title: "Send the invoice", dueOn: today });
  const soon = await store.addTask("aquila", id, { title: "Check in", dueOn: c.addDays(today, 3) });
  await store.addTask("aquila", id, { title: "Far away", dueOn: c.addDays(today, 40) });
  await assert.rejects(store.addTask("aquila", id, { title: "x", dueOn: "tomorrow" }), /due date/);
  assert.ok(!(await store.needsFollowUp("aquila")).some((x) => x.id === id), "now has open tasks");
  const g = await store.dueTasks("aquila", today, 7, c.addDays);
  assert.ok(g.overdue.some((t) => t.id === overdue));
  assert.ok(g.today.some((t) => t.id === due));
  assert.ok(g.upcoming.some((t) => t.id === soon));
  assert.ok(!g.upcoming.some((t) => t.title === "Far away"), "beyond the window");
  await store.setTaskDue("aquila", overdue, c.addDays(today, 1));
  assert.ok(!(await store.dueTasks("aquila", today, 7, c.addDays)).overdue.some((t) => t.id === overdue), "snoozed out of overdue");
  assert.equal(await store.completeTask("aquila", due), true);
  assert.equal(await store.completeTask("aquila", due), false, "cannot complete twice");
  assert.ok((await store.listActivities("aquila", id)).some((a) => /Task done: Send the invoice/.test(a.body)));
  assert.ok((await store.tasksForLead("aquila", id)).find((x) => x.id === due).done_at);
});

test("pipeline counts only people you are dealing with, not every scanned business", async () => {
  const scanned = (await store.listLeads("aquila", { bucket: "no_website" })).find((l) => l.source === "kestrel" && l.stage === "new" && !l.draft_status);
  assert.ok(scanned, "a plain scanned business exists");
  const before = (await store.stageCounts("aquila")).new || 0;
  const rows = await store.leadsByStage("aquila", "new", 100);
  assert.ok(!rows.some((r) => r.id === scanned.id), "scanned business is not on the board");
  await store.saveDraft("aquila", scanned.id, { subject: "Hello there", body: "A long enough body for the draft to save properly." });
  assert.equal((await store.stageCounts("aquila")).new, before + 1, "a draft brings it into the pipeline");
  assert.ok((await store.leadsByStage("aquila", "new", 100)).some((r) => r.id === scanned.id));
  const lf = await import("../lib/leadfilters.js");
  assert.equal(lf.parseFilters({ stage: "won" }).stage, "won");
  assert.equal(lf.parseFilters({ stage: "x" }).stage, "any");
  const replied = lf.parseFilters({ site: "any", stage: "replied" });
  assert.ok((await store.countLeadsFiltered("aquila", replied)) >= 1);
});

test("crm data is isolated per brand", async () => {
  const id = await store.createContact("aquila", { name: "Brand A Contact", source: "manual" });
  const task = await store.addTask("aquila", id, { title: "Private", dueOn: "2030-01-01" });
  assert.equal(await store.getLead("other", id), null);
  assert.deepEqual(await store.listActivities("other", id), []);
  assert.deepEqual(await store.tasksForLead("other", id), []);
  await assert.rejects(store.addTask("other", id, { title: "Sneaky", dueOn: "2030-01-01" }), /Contact not found/);
  await assert.rejects(store.setStage("other", id, "won"), /Contact not found/);
  assert.equal(await store.completeTask("other", task), false);
  assert.ok(!(await store.dueTasks("other", "2030-01-01", 7, (await import("../lib/crm.js")).addDays)).today.some((x) => x.id === task));
  assert.equal((await store.getLead("aquila", id)).stage, "new", "untouched");
});

test("opening an existing database again keeps it and maps old statuses to stages", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openLocal } = await import("../lib/db.js");
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-mig2-")), "pglite");
  const a = await openLocal(dir);
  const ins = (pid, status) => a.query("INSERT INTO leads (brand_id, place_id, name, bucket, mockup_token, status, first_seen_at, last_seen_at) VALUES ('aquila', $1, $1, 'no_website', $1, $2, 'n', 'n')", [pid, status]);
  await ins("old1", "contacted");
  await ins("old2", "do_not_contact");
  await ins("old3", "new");
  await a.exec("UPDATE leads SET stage = 'new'"); // as if the column had just been added
  await a.close();
  const b = await openLocal(dir); // runs the schema again: must be safe to repeat
  const rows = (await b.query("SELECT place_id, stage FROM leads ORDER BY place_id")).rows;
  assert.deepEqual(rows.map((r) => r.stage), ["contacted", "not_interested", "new"]);
  await b.close();
});

// ---------------- clients, projects, meetings, exports ----------------

test("money and meeting time helpers", async () => {
  const c = await import("../lib/crm.js");
  assert.equal(c.parseMoneyToCents("1500"), 150000);
  assert.equal(c.parseMoneyToCents("$1,500.50"), 150050);
  assert.equal(c.parseMoneyToCents("99.5"), 9950);
  for (const bad of ["", "abc", "-5", "1e5", "10.999", "12 dollars", "1,2,3x"]) assert.equal(c.parseMoneyToCents(bad), null, bad);
  assert.equal(c.formatCents(150050), "$1,500.50");
  assert.equal(c.formatCents(null), "Not quoted");
  const iso = c.localInputToIso("2026-11-06T14:30");
  assert.equal(new Date(iso).getHours(), 14, "read in local time");
  assert.equal(c.localInputToIso("tomorrow"), null);
  assert.equal(c.localInputToIso("2026-13-45T99:99"), null);
  const w = c.nextDaysWindow(7, Date.UTC(2026, 10, 5));
  assert.equal(w.toIso, "2026-11-12T00:00:00.000Z");
});

test("clients: convert a won contact once, add direct clients, projects and totals", async () => {
  const lead = await store.createContact("aquila", { name: "Convert Me", email: "convert@example.test", phone: "(555) 010-0300", source: "referral" });
  const r = await store.convertToClient("aquila", lead);
  assert.equal(r.created, true);
  assert.equal((await store.convertToClient("aquila", lead)).id, r.id, "converting twice returns the same client");
  assert.equal((await store.getLead("aquila", lead)).stage, "won");
  assert.ok((await store.listActivities("aquila", lead)).some((a) => /Converted to a client/.test(a.body)));
  const client = await store.getClient("aquila", r.id);
  assert.equal(client.email, "convert@example.test");
  assert.equal((await store.getClientByLead("aquila", lead)).id, r.id);
  const direct = await store.createClient("aquila", { name: "Existing Client Co" });
  assert.equal((await store.getClient("aquila", direct)).lead_id, null);
  const p1 = await store.createProject("aquila", r.id, { name: "New website", type: "website", status: "in_progress", quotedCents: 250000, startOn: "2026-11-10", targetOn: "2026-12-10" });
  await store.createProject("aquila", r.id, { name: "Dropped idea", type: "app", status: "cancelled", quotedCents: 999900 });
  await store.createProject("aquila", r.id, { name: "Unpriced", type: "other", status: "proposed" });
  const row = (await store.listClients("aquila")).find((c) => c.id === r.id);
  assert.equal(row.project_count, 2, "cancelled projects are not counted");
  assert.equal(Number(row.quoted_total), 250000, "or summed");
  await store.setProjectStatus("aquila", p1, "delivered");
  assert.equal((await store.listProjects("aquila", { clientId: r.id })).find((p) => p.id === p1).status, "delivered");
  await assert.rejects(store.createProject("aquila", r.id, { name: "Bad", type: "spaceship", status: "proposed" }), "database rejects unknown types");
  await store.setClientStatus("aquila", r.id, "paused");
  assert.equal((await store.getClient("aquila", r.id)).status, "paused");
});

test("meetings: one owner, stage moves, windows, and brand isolation", async () => {
  const c = await import("../lib/crm.js");
  const lead = await store.createContact("aquila", { name: "Meet Me", source: "inbound" });
  const startsAt = c.localInputToIso("2030-03-04T10:00");
  const m = await store.createMeeting("aquila", { leadId: lead, title: "Intro call", location: "meet", startsAt });
  assert.equal((await store.getLead("aquila", lead)).stage, "meeting_booked");
  assert.ok((await store.listActivities("aquila", lead)).some((a) => a.kind === "meeting"));
  await assert.rejects(store.createMeeting("aquila", { title: "x", location: "meet", startsAt }), /contact or a client/);
  await assert.rejects(store.createMeeting("aquila", { leadId: lead, clientId: 1, title: "x", location: "meet", startsAt }), /contact or a client/);
  await assert.rejects(store.createMeeting("aquila", { leadId: lead, title: "x", location: "teleporter", startsAt }), "database rejects unknown places");
  await assert.rejects(store.createMeeting("other", { leadId: lead, title: "Sneaky", location: "meet", startsAt }), /not found/);
  const clientId = await store.createClient("aquila", { name: "Meeting Client" });
  const m2 = await store.createMeeting("aquila", { clientId, title: "Check-in", location: "phone", startsAt: c.localInputToIso("2030-03-05T09:00") });
  const inWindow = await store.listMeetings("aquila", { fromIso: "2030-03-04T00:00:00.000Z", toIso: "2030-03-05T00:00:00.000Z" });
  assert.ok(inWindow.some((x) => x.id === m) && !inWindow.some((x) => x.id === m2));
  assert.equal((await store.listMeetings("other", { fromIso: "2030-01-01T00:00:00.000Z" })).length, 0, "other brands see none");
  await store.setMeetingStatus("aquila", m, "done");
  assert.equal((await store.listMeetings("aquila", { limit: 500 })).find((x) => x.id === m).status, "done");
  await store.setMeetingStatus("other", m2, "cancelled");
  assert.equal((await store.listMeetings("aquila", { limit: 500 })).find((x) => x.id === m2).status, "scheduled", "another brand cannot change it");
});

test("client and project data is isolated per brand", async () => {
  const id = await store.createClient("aquila", { name: "Brand A Client" });
  assert.equal(await store.getClient("other", id), null);
  await assert.rejects(store.createProject("other", id, { name: "Sneaky", type: "website", status: "proposed" }), /Client not found/);
  await store.setClientStatus("other", id, "ended");
  assert.equal((await store.getClient("aquila", id)).status, "active");
  assert.ok(!(await store.listClients("other")).some((c) => c.id === id));
});

test("contacts export holds the pipeline, not every scanned business", async () => {
  const rows = await store.contactsForExport("aquila");
  assert.ok(rows.length >= 1);
  const names = rows.map((r) => r.name);
  assert.ok(names.includes("Convert Me"));
  const scanned = (await store.listLeads("aquila")).find((l) => l.source === "kestrel" && l.stage === "new" && !l.draft_status);
  assert.ok(scanned, "a plain scanned business exists");
  assert.ok(!names.includes(scanned.name), "a plain scanned business is not exported");
  const { csvCell } = await import("../lib/leadfilters.js");
  assert.equal(csvCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
});

// ---------------- connections ----------------

test("booking link validation only accepts safe public https links", async () => {
  const { validateBookingLink: v } = await import("../lib/connectors/bookinglink.js");
  assert.deepEqual(v("https://calendar.app.google/abc123"), { ok: true, value: "https://calendar.app.google/abc123" });
  assert.equal(v("  https://cal.com/steven/intro#top ").value, "https://cal.com/steven/intro", "fragment removed");
  for (const bad of ["", "calendar.app.google/abc", "http://cal.com/x", "javascript:alert(1)", "https://user:pw@cal.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.5/x", "https://printer.local/x", "https://intranet/x", "https://[::1]/x", "https://cal.com/" + "a".repeat(300)]) {
    assert.equal(v(bad).ok, false, bad);
  }
});

test("connections store: secrets encrypted, disconnect erases, brand isolated, booking url", async () => {
  await store.saveConnection("aquila", "booking_link", { status: "connected", config: { url: "https://cal.com/steven/intro" } });
  assert.equal(await store.getBookingUrl("aquila"), "https://cal.com/steven/intro");
  assert.equal(await store.getBookingUrl("other"), null, "another brand has none");
  await store.saveConnection("aquila", "test_provider", { status: "connected", config: { x: 1 }, secret: { token: "super-secret-token-value" }, scopes: "read" });
  const row = await store.getConnection("aquila", "test_provider");
  assert.ok(!JSON.stringify(row).includes("super-secret-token-value"), "secret is not stored in plain text");
  assert.deepEqual(store.readConnectionSecret(row), { token: "super-secret-token-value" });
  await store.saveConnection("aquila", "test_provider", { status: "connected", config: { x: 2 } }); // update without a secret keeps the old one
  assert.deepEqual(store.readConnectionSecret(await store.getConnection("aquila", "test_provider")), { token: "super-secret-token-value" });
  assert.equal(await store.getConnection("other", "test_provider"), null);
  await store.recordConnectionCheck("aquila", "test_provider", { ok: false, message: "nope" });
  const bad = await store.getConnection("aquila", "test_provider");
  assert.equal(bad.status, "error");
  assert.equal(bad.last_error, "nope");
  await store.disconnectConnection("aquila", "test_provider");
  const gone = await store.getConnection("aquila", "test_provider");
  assert.equal(gone.status, "disconnected");
  assert.equal(gone.secret_enc, null);
  assert.equal(gone.config, "{}");
  await store.disconnectConnection("aquila", "booking_link");
  assert.equal(await store.getBookingUrl("aquila"), null, "a disconnected link is not used");
  await store.recordConnectionCheck("aquila", "brand_new", { ok: true });
  assert.equal((await store.getConnection("aquila", "brand_new")).status, "connected", "check can create the row");
});

test("paypal check: sandbox by default, live blocked, errors never leak credentials", async () => {
  const paypal = (await import("../lib/connectors/paypal.js")).default;
  const env = { PAYPAL_CLIENT_ID: "ID_VALUE_123", PAYPAL_CLIENT_SECRET: "SECRET_VALUE_456" };
  assert.equal((await paypal.check({ env: {} })).ok, false);
  const calls = [];
  const good = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ access_token: "tok-1234567890", token_type: "Bearer", expires_in: 32400 }) }; };
  const ok = await paypal.check({ env, fetchImpl: good });
  assert.equal(ok.ok, true);
  assert.match(ok.message, /sandbox/);
  assert.equal(calls[0].url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  assert.equal(calls[0].init.body, "grant_type=client_credentials");
  assert.equal(calls[0].init.headers.Authorization, "Basic " + Buffer.from("ID_VALUE_123:SECRET_VALUE_456").toString("base64"));
  const live = await paypal.check({ env: { ...env, PAYPAL_ENV: "live" }, fetchImpl: good });
  assert.equal(live.ok, false, "live is blocked until approved");
  assert.equal(calls.length, 1, "no request was made for the blocked live attempt");
  const approved = await paypal.check({ env: { ...env, PAYPAL_ENV: "live", PAYPAL_ALLOW_LIVE: "1" }, fetchImpl: good });
  assert.equal(approved.ok, true);
  assert.equal(calls[1].url, "https://api-m.paypal.com/v1/oauth2/token");
  const bad401 = await paypal.check({ env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_client" }) }) });
  const boom = await paypal.check({ env, fetchImpl: async () => { throw new Error("socket hang up " + env.PAYPAL_CLIENT_SECRET); } });
  const weird = await paypal.check({ env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) }) });
  const five = await paypal.check({ env, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  for (const r of [bad401, boom, weird, five]) {
    assert.equal(r.ok, false);
    assert.ok(!r.message.includes("SECRET_VALUE_456") && !r.message.includes("ID_VALUE_123") && !r.message.includes("tok-"), "no credentials in messages");
  }
  assert.match(bad401.message, /rejected/);
});

test("connector registry: states and the other connectors", async () => {
  const { CONNECTORS, describeConnector, getConnector, connectorIds } = await import("../lib/connectors/index.js");
  assert.deepEqual(connectorIds(), ["booking_link", "paypal", "resend", "google_calendar"]);
  assert.equal(getConnector("nope"), null);
  const book = getConnector("booking_link");
  assert.equal(describeConnector(book, null).state, "not_connected");
  assert.equal(describeConnector(book, { status: "connected", config: JSON.stringify({ url: "https://cal.com/x" }) }).state, "connected");
  assert.equal(describeConnector(book, { status: "error", config: "{}", last_error: "bad" }).detail, "bad");
  const pp = getConnector("paypal");
  assert.equal(describeConnector(pp, null, {}).state, "not_connected");
  assert.match(describeConnector(pp, null, {}).detail, /PAYPAL_CLIENT_ID/);
  assert.equal(describeConnector(pp, { status: "connected" }, { PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" }).state, "connected");
  assert.equal(describeConnector(pp, { status: "error", last_error: "x" }, { PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" }).state, "error");
  const g = getConnector("google_calendar");
  assert.equal(describeConnector(g, null).state, "unavailable");
  assert.equal((await g.check()).ok, false);
  const re = getConnector("resend");
  assert.equal((await re.check({ env: {} })).ok, false);
  assert.equal((await re.check({ env: { RESEND_API_KEY: "k", SENDER_EMAIL: "a@b.test" } })).ok, true);
  for (const c of CONNECTORS) {
    assert.ok(c.id && c.name && c.description && ["setting", "env", "unavailable"].includes(c.mode));
    assert.equal(typeof c.check, "function");
  }
});

test("the booking link goes into outreach drafts only when one is saved", async () => {
  const { buildDraft } = await import("../lib/email.js");
  const brand = getBrand("aquila");
  const lead = { name: "Draft Co", city: "Erie", phone: "" };
  const without = buildDraft({ lead, brand, mockupLink: "https://x.test/m/1" });
  assert.ok(!without.body.includes("pick a time"));
  const withLink = buildDraft({ lead, brand, mockupLink: "https://x.test/m/1", bookingLink: "https://cal.com/steven/intro" });
  assert.ok(withLink.body.includes("pick a time to talk here: https://cal.com/steven/intro"));
  assert.ok(!/[\u2013\u2014]/.test(withLink.body), "no dash punctuation");
});

// ---------------- PayPal invoicing (against a stand-in for PayPal) ----------------

/** A small fake of the parts of PayPal we use. Records every call so tests can inspect them. */
function fakePayPal({ expire401Once = false } = {}) {
  const state = { invoices: new Map(), byRequest: new Map(), calls: [], tokensIssued: 0, failNext: null, n: 0, expireNext: expire401Once };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const call = { method: init.method || "GET", path: u.pathname, headers: init.headers || {}, body: init.body ? (init.headers["Content-Type"] === "application/json" ? JSON.parse(init.body) : init.body) : null };
    state.calls.push(call);
    if (state.failNext === "network") { state.failNext = null; throw new Error("socket hang up"); }
    if (u.pathname === "/v1/oauth2/token") {
      if (!String(call.headers.Authorization).startsWith("Basic ")) return json(401, { error: "invalid_client" });
      state.tokensIssued++;
      return json(200, { access_token: "token-" + state.tokensIssued + "-abcdefghij", token_type: "Bearer", expires_in: 32400 });
    }
    if (state.expireNext) { state.expireNext = false; return json(401, { name: "AUTHENTICATION_FAILURE" }); }
    if (!String(call.headers.Authorization).startsWith("Bearer token-")) return json(401, {});
    if (state.failNext) { const s = state.failNext; state.failNext = null; return json(s, { name: "SERVER", message: "boom secret-id-123" }); }
    if (call.method === "POST" && u.pathname === "/v2/invoicing/invoices") {
      const rid = call.headers["PayPal-Request-Id"];
      if (state.byRequest.has(rid)) return json(201, state.invoices.get(state.byRequest.get(rid)));
      const b = call.body;
      if (!b.items?.length || !b.primary_recipients?.[0]?.billing_info?.email_address || !b.detail?.currency_code) {
        return json(422, { name: "UNPROCESSABLE_ENTITY", message: "Invalid request", details: [{ issue: "MISSING_REQUIRED_FIELD", description: "items required" }] });
      }
      const id = "INV2-FAKE-" + String(++state.n).padStart(4, "0");
      const total = (Number(b.items[0].unit_amount.value)).toFixed(2);
      const inv = { id, status: "DRAFT", detail: { invoice_number: "0000" + state.n, payment_term: { due_date: "2030-01-31" }, metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#" + id } }, amount: { currency_code: "USD", value: total }, due_amount: { currency_code: "USD", value: total }, _body: b };
      state.invoices.set(id, inv); state.byRequest.set(rid, id);
      return json(201, call.headers.Prefer === "return=representation" ? inv : { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/" + id, method: "GET" });
    }
    const m = u.pathname.match(/^[/]v2[/]invoicing[/]invoices[/]([^/]+)([/]send)?$/);
    if (m) {
      const inv = state.invoices.get(m[1]);
      if (!inv) return json(404, { name: "RESOURCE_NOT_FOUND", message: "Invoice not found" });
      if (m[2] && call.method === "POST") { inv.status = "SENT"; return json(202, null); }
      if (call.method === "GET") { const { _body, ...pub } = inv; return json(200, pub); }
    }
    return json(404, {});
  };
  state.pay = (id, value) => { const i = state.invoices.get(id); i.status = "PAID"; i.due_amount = { currency_code: "USD", value: "0.00" }; i.payments = { paid_amount: { currency_code: "USD", value } }; };
  return { fetchImpl, state };
}

test("paypal client: signs in once, reuses the token, refreshes on expiry, safe errors", async () => {
  const pp = await import("../lib/paypal.js");
  pp.clearPayPalTokenCache();
  const env = { PAYPAL_CLIENT_ID: "ID_VALUE_123", PAYPAL_CLIENT_SECRET: "SECRET_VALUE_456" };
  assert.throws(() => pp.paypalClient({ env: {} }), /not connected/);
  assert.throws(() => pp.paypalClient({ env: { ...env, PAYPAL_ENV: "live" } }), /Live PayPal is switched off/);
  const fake = fakePayPal();
  const client = pp.paypalClient({ env, fetchImpl: fake.fetchImpl });
  assert.equal(client.mode, "sandbox");
  const { id } = await client.createInvoice({ requestId: "req-1", recipientEmail: "c@example.test", itemName: "Website", amountCents: 250050 });
  assert.match(id, /^INV2-FAKE-/);
  const create = fake.state.calls.find((c) => c.path === "/v2/invoicing/invoices");
  assert.equal(create.headers["PayPal-Request-Id"], "req-1");
  assert.equal(create.body.items[0].unit_amount.value, "2500.50", "dollars string from integer cents");
  assert.equal(create.body.items[0].quantity, "1");
  assert.equal(create.body.primary_recipients[0].billing_info.email_address, "c@example.test");
  assert.equal(create.body.detail.currency_code, "USD");
  const again = await client.createInvoice({ requestId: "req-1", recipientEmail: "c@example.test", itemName: "Website", amountCents: 250050 });
  assert.equal(again.id, id, "same request id returns the same invoice");
  assert.equal(fake.state.invoices.size, 1, "no duplicate was created");
  await client.getInvoice(id);
  assert.equal(fake.state.tokensIssued, 1, "one sign in served all the calls");
  // an expired token is refreshed once and the call retried
  const f2 = fakePayPal({ expire401Once: true });
  pp.clearPayPalTokenCache();
  const c2 = pp.paypalClient({ env, fetchImpl: f2.fetchImpl });
  await c2.createInvoice({ requestId: "r", recipientEmail: "c@example.test", itemName: "X", amountCents: 1000 });
  assert.equal(f2.state.tokensIssued, 2);
  // errors are short, safe, and never contain credentials or tokens
  f2.state.failNext = 503;
  await assert.rejects(c2.getInvoice("INV2-FAKE-0001"), (e) => e instanceof pp.PayPalError && /having trouble/.test(e.message) && !/secret-id-123|token-|SECRET_VALUE|ID_VALUE/.test(e.message));
  f2.state.failNext = "network";
  await assert.rejects(c2.getInvoice("INV2-FAKE-0001"), /Could not reach PayPal/);
  await assert.rejects(c2.getInvoice("INV2-NOPE"), /Invoice not found/);
  await assert.rejects(c2.createInvoice({ requestId: "bad", recipientEmail: "", itemName: "X", amountCents: 100 }), /PayPal said: Invalid request/);
  // an unexpected reply shape is rejected, not trusted
  const weird = pp.paypalClient({ env, fetchImpl: async (u) => (String(u).includes("oauth2") ? { ok: true, status: 200, json: async () => ({ access_token: "token-abcdefghij", expires_in: 100 }) } : { ok: true, status: 200, json: async () => ({ hello: "world" }) }) });
  pp.clearPayPalTokenCache();
  await assert.rejects(weird.getInvoice("X"), /unexpected reply/);
  assert.equal(pp.safePayPalUrl("https://www.sandbox.paypal.com/invoice/p/#X"), "https://www.sandbox.paypal.com/invoice/p/#X");
  assert.equal(pp.safePayPalUrl("https://evil.example/paypal.com"), null);
  assert.equal(pp.safePayPalUrl("http://www.paypal.com/x"), null);
  assert.equal(pp.safePayPalUrl("javascript:alert(1)"), null);
});

test("invoice rules: amounts by kind, no overbilling, status groups, overdue", async () => {
  const r = await import("../lib/invoicestatus.js");
  assert.equal(r.amountForKind("full", 100000, 0), 100000);
  assert.equal(r.amountForKind("full", 100000, 50000), null, "cannot bill the full amount twice");
  assert.equal(r.amountForKind("deposit", 100001, 0), 50001, "rounds to a whole cent");
  assert.equal(r.amountForKind("deposit", 100000, 50000), null);
  assert.equal(r.amountForKind("balance", 100000, 50000), 50000);
  assert.equal(r.amountForKind("balance", 100000, 0), null, "no balance before a deposit");
  assert.equal(r.amountForKind("balance", 100000, 100000), null, "nothing left to bill");
  assert.equal(r.amountForKind("full", null, 0), null);
  assert.equal(r.amountForKind("bogus", 100, 0), null);
  assert.equal(r.centsFromPayPal("2500.50"), 250050);
  assert.equal(r.centsFromPayPal("12"), 1200);
  assert.equal(r.centsFromPayPal("abc"), null);
  assert.equal(r.centsFromPayPal(undefined), null);
  for (const [s, g] of [["DRAFT", "draft"], ["SENT", "sent"], ["UNPAID", "sent"], ["SCHEDULED", "sent"], ["PARTIALLY_PAID", "partial"], ["PAID", "paid"], ["MARKED_AS_PAID", "paid"], ["CANCELLED", "cancelled"], ["REFUNDED", "refunded"], ["PENDING", "pending"], ["FAILED", "failed"], ["SOMETHING_NEW", "unknown"]]) {
    assert.equal(r.statusGroup(s), g, s);
  }
  assert.equal(r.isOverdue({ status: "SENT", due_on: "2026-11-01" }, "2026-11-05"), true);
  assert.equal(r.isOverdue({ status: "SENT", due_on: "2026-11-05" }, "2026-11-05"), false);
  assert.equal(r.isOverdue({ status: "PAID", due_on: "2026-11-01" }, "2026-11-05"), false);
  assert.equal(r.isOverdue({ status: "DRAFT", due_on: "2026-11-01" }, "2026-11-05"), false);
});

test("invoicing end to end: draft, send, pay, reconcile, outstanding, retries, isolation", async () => {
  const pp = await import("../lib/paypal.js");
  const inv = await import("../lib/invoicing.js");
  pp.clearPayPalTokenCache();
  const env = { PAYPAL_CLIENT_ID: "ID", PAYPAL_CLIENT_SECRET: "SECRET" };
  const fake = fakePayPal();
  const paypal = pp.paypalClient({ env, fetchImpl: fake.fetchImpl });

  const lead = await store.createContact("aquila", { name: "Invoice Lead", email: "billing@example.test", source: "referral" });
  const { id: clientId } = await store.convertToClient("aquila", lead);
  const projectId = await store.createProject("aquila", clientId, { name: "Big website", type: "website", status: "in_progress", quotedCents: 100000 });
  const noQuote = await store.createProject("aquila", clientId, { name: "Unpriced", type: "other", status: "proposed" });
  await assert.rejects(inv.createDraftInvoice({ brandId: "aquila", projectId: noQuote, kind: "full", paypal }), /quoted amount/);
  await assert.rejects(inv.createDraftInvoice({ brandId: "aquila", projectId, kind: "balance", paypal }), /not available/);
  await assert.rejects(inv.createDraftInvoice({ brandId: "other", projectId, kind: "full", paypal }), /Project not found/, "another brand cannot invoice it");

  // deposit
  const dep = await inv.createDraftInvoice({ brandId: "aquila", projectId, kind: "deposit", paypal });
  let row = await store.getInvoiceRow("aquila", dep);
  assert.equal(row.amount_cents, 50000);
  assert.equal(row.status, "DRAFT");
  assert.ok(row.paypal_invoice_id.startsWith("INV2-FAKE-"));
  assert.ok(row.invoice_number, "invoice number read back from PayPal");
  assert.match(row.view_url, /paypal\.com/);
  assert.equal(row.due_on, "2030-01-31");
  assert.equal(await store.invoicedTotalForProject("aquila", projectId), 50000);
  await assert.rejects(inv.createDraftInvoice({ brandId: "aquila", projectId, kind: "full", paypal }), /not available/, "deposit already billed");

  // sending
  await assert.rejects(inv.sendInvoice({ brandId: "aquila", invoiceId: 999999, paypal }), /Create the invoice first/);
  await inv.sendInvoice({ brandId: "aquila", invoiceId: dep, paypal });
  row = await store.getInvoiceRow("aquila", dep);
  assert.equal(row.status, "SENT");
  assert.ok(row.sent_at);
  assert.ok((await store.listActivities("aquila", lead)).some((a) => a.kind === "payment" && /sent through PayPal/.test(a.body)));
  await assert.rejects(inv.sendInvoice({ brandId: "aquila", invoiceId: dep, paypal }), /Only a draft/, "no double send");
  let owed = await store.outstandingSummary("aquila", "2026-11-05");
  assert.equal(owed.outstandingCents, 50000);
  assert.equal(owed.overdueCount, 0);
  const lateOwed = await store.outstandingSummary("aquila", "2030-02-01");
  assert.equal(lateOwed.overdueCount, 1, "past its due date");
  assert.equal(lateOwed.overdueCents, 50000);

  // balance invoice
  const bal = await inv.createDraftInvoice({ brandId: "aquila", projectId, kind: "balance", paypal });
  assert.equal((await store.getInvoiceRow("aquila", bal)).amount_cents, 50000);
  await assert.rejects(inv.createDraftInvoice({ brandId: "aquila", projectId, kind: "balance", paypal }), /not available/, "fully billed");

  // payment arrives; reconcile is idempotent
  fake.state.pay((await store.getInvoiceRow("aquila", dep)).paypal_invoice_id, "500.00");
  const r1 = await inv.reconcileInvoice({ brandId: "aquila", invoiceId: dep, paypal });
  assert.equal(r1.becamePaid, true);
  const r2 = await inv.reconcileInvoice({ brandId: "aquila", invoiceId: dep, paypal });
  assert.equal(r2.becamePaid, false, "second reconcile changes nothing");
  const payments = (await store.listActivities("aquila", lead)).filter((a) => a.kind === "payment" && /paid/.test(a.body));
  assert.equal(payments.length, 1, "one timeline entry for the payment");
  assert.ok((await store.getInvoiceRow("aquila", dep)).paid_at);
  owed = await store.outstandingSummary("aquila", "2026-11-05");
  assert.equal(owed.outstandingCents, 0, "paid money is no longer outstanding (the balance is still a draft)");

  // reconcile all: one PayPal failure does not stop the rest
  await inv.sendInvoice({ brandId: "aquila", invoiceId: bal, paypal });
  fake.state.failNext = 500;
  const sum = await inv.reconcileAll({ brandId: "aquila", paypal });
  assert.equal(sum.failed, 1);
  assert.match((await store.getInvoiceRow("aquila", bal)).last_error, /Payment status unavailable/);
  assert.equal((await store.getInvoiceRow("aquila", bal)).status, "SENT", "status kept when PayPal is down");
  const sum2 = await inv.reconcileAll({ brandId: "aquila", paypal });
  assert.equal(sum2.failed, 0);
  assert.equal((await store.getInvoiceRow("aquila", bal)).last_error, null, "error clears on the next good check");

  // failed create keeps its request id and retries safely
  const project2 = await store.createProject("aquila", clientId, { name: "Second", type: "app", status: "proposed", quotedCents: 20000 });
  fake.state.failNext = "network";
  await assert.rejects(inv.createDraftInvoice({ brandId: "aquila", projectId: project2, kind: "full", paypal }), /Could not reach PayPal/);
  const failed = (await store.listInvoices("aquila", { projectId: project2 }))[0];
  assert.equal(failed.status, "FAILED");
  assert.equal(await store.invoicedTotalForProject("aquila", project2), 0, "a failed invoice is not billed");
  const before = fake.state.invoices.size;
  await inv.retryCreate({ brandId: "aquila", invoiceId: failed.id, paypal });
  assert.equal(fake.state.invoices.size, before + 1);
  assert.equal((await store.getInvoiceRow("aquila", failed.id)).status, "DRAFT");
  await inv.retryCreate({ brandId: "aquila", invoiceId: failed.id, paypal });
  assert.equal(fake.state.invoices.size, before + 1, "retrying a created invoice does nothing");

  // brand isolation
  assert.equal(await store.getInvoiceRow("other", dep), null);
  assert.deepEqual(await store.listInvoices("other"), []);
  assert.equal((await store.outstandingSummary("other", "2030-02-01")).count, 0);
  await assert.rejects(inv.reconcileInvoice({ brandId: "other", invoiceId: dep, paypal }), /not found/);
  assert.equal((await store.getProject("other", projectId)), null);
});

test("the PayPal test address override only ever points at this computer", async () => {
  const { paypalBaseFor } = await import("../lib/connectors/paypal.js");
  assert.equal(paypalBaseFor({}), "https://api-m.sandbox.paypal.com");
  assert.equal(paypalBaseFor({ PAYPAL_ENV: "live" }), "https://api-m.paypal.com");
  assert.equal(paypalBaseFor({ PAYPAL_TEST_BASE_URL: "http://127.0.0.1:4010" }), "http://127.0.0.1:4010");
  assert.equal(paypalBaseFor({ PAYPAL_TEST_BASE_URL: "http://localhost:4010/x" }), "http://localhost:4010");
  for (const bad of ["https://evil.example", "http://evil.example", "http://127.0.0.1.evil.example", "http://192.168.1.5:4010", "ftp://localhost", "not a url", "https://localhost:4010"]) {
    assert.equal(paypalBaseFor({ PAYPAL_TEST_BASE_URL: bad }), "https://api-m.sandbox.paypal.com", bad);
  }
});

test("a connection made before the schema grew repairs itself instead of failing", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const prev = process.env.PGLITE_DIR;
  process.env.PGLITE_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-stale-schema-")), "pglite");
  delete globalThis.__kestrelDb;
  delete globalThis.__kestrelMigratedAt;
  const { query } = await import("../lib/db.js");
  await query("SELECT 1 AS ok"); // connects with the full schema
  // Pretend this connection predates the newest tables and columns.
  await query("DROP TABLE tasks");
  await query("ALTER TABLE leads DROP COLUMN stage CASCADE");
  const rows = await query("SELECT COUNT(*)::int AS n FROM tasks"); // would have thrown: relation does not exist
  assert.equal(rows[0].n, 0);
  const stage = await query("SELECT stage FROM leads LIMIT 1");
  assert.ok(Array.isArray(stage), "the missing column was restored too");
  await assert.rejects(query("SELECT * FROM table_that_never_existed"), (e) => e.code === "42P01", "genuine mistakes still fail, with the original error");
  process.env.PGLITE_DIR = prev;
  delete globalThis.__kestrelDb;
  delete globalThis.__kestrelMigratedAt;
});

// ---------------- calendar ----------------

test("calendar grid, month navigation and validation", async () => {
  const c = await import("../lib/calendar.js");
  assert.deepEqual(c.parseMonth("2026-11"), { year: 2026, month: 11 });
  for (const bad of ["", "2026-13", "2026-00", "26-11", "2026-1", "abcd-ef", null, "1999-12", "2101-01"]) assert.equal(c.parseMonth(bad), null, String(bad));
  assert.deepEqual(c.shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(c.shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(c.shiftMonth({ year: 2026, month: 5 }, 14), { year: 2027, month: 7 });
  assert.equal(c.monthKey({ year: 2026, month: 3 }), "2026-03");
  assert.equal(c.monthTitle({ year: 2026, month: 11 }), "November 2026");
  const weeks = c.monthGrid({ year: 2026, month: 11 }); // Nov 1, 2026 is a Sunday; Nov 30 is a Monday
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks[0][0].date, "2026-11-01");
  assert.equal(weeks[0][0].inMonth, true);
  assert.equal(weeks[4][6].date, "2026-12-05");
  assert.equal(weeks[4][6].inMonth, false);
  const feb = c.monthGrid({ year: 2026, month: 2 }); // starts on a Sunday, exactly four weeks
  assert.equal(feb.length, 4);
  const may = c.monthGrid({ year: 2026, month: 5 }); // starts on a Friday, so it begins in April
  assert.equal(may[0][0].date, "2026-04-26");
  assert.equal(may[0][0].inMonth, false);
  const days = weeks.flat().map((d) => d.date);
  assert.equal(new Set(days).size, days.length, "no day appears twice");
  assert.equal(c.localDay(new Date(2026, 10, 5, 23, 30).toISOString()), "2026-11-05");
  assert.equal(c.dayAfterIso("2026-11-30"), c.dayStartIso("2026-12-01"));
  assert.deepEqual(c.scheduledDays("weekdays", "2026-11-06", "2026-11-10"), ["2026-11-06", "2026-11-09", "2026-11-10"]);
  assert.deepEqual(c.scheduledDays("weekly", "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(c.scheduledDays("daily", "2026-11-01", "2026-11-30").length, 30);
  assert.deepEqual(c.scheduledDays("manual", "2026-11-01", "2026-11-30"), []);
});

test("calendar assembles meetings, follow-ups, invoices and scans per day, in order", async () => {
  const c = await import("../lib/calendar.js");
  const at = (d, h) => new Date(2026, 10, d, h, 0).toISOString();
  const byDay = c.assembleCalendar({
    meetings: [
      { id: 1, title: "Intro call", location: "meet", starts_at: at(10, 15), status: "scheduled", lead_id: 5, lead_name: "Pat" },
      { id: 2, title: "Check-in", location: "phone", starts_at: at(10, 9), status: "scheduled", client_id: 3, client_name: "Acme" },
      { id: 3, title: "Cancelled one", location: "meet", starts_at: at(10, 11), status: "cancelled", lead_id: 5, lead_name: "Pat" },
    ],
    tasks: [{ id: 1, title: "Send the quote", due_on: "2026-11-10", lead_id: 5, lead_name: "Pat" }, { id: 2, title: "Out of range", due_on: "2027-01-01", lead_id: 5 }],
    invoices: [{ id: 1, due_on: "2026-11-10", amount_cents: 125025, due_cents: 125025, currency: "USD", client_name: "Acme", invoice_number: "0001" }],
    campaigns: [{ id: 9, name: "All businesses in Erie", enabled: true, frequency: "weekly", run_time: "06:00" }, { id: 10, name: "Paused", enabled: false, frequency: "daily", run_time: "06:00" }],
  }, "2026-11-01", "2026-11-30");
  const tenth = byDay["2026-11-10"];
  assert.deepEqual(tenth.map((i) => i.type), ["meeting", "meeting", "task", "invoice"]);
  assert.match(tenth[0].title, /Check-in/, "earlier meeting first");
  assert.match(tenth[1].title, /Intro call/);
  assert.ok(!tenth.some((i) => /Cancelled/.test(i.title)), "cancelled meetings are hidden");
  assert.equal(tenth[0].href, "/clients/3");
  assert.equal(tenth[1].href, "/leads/5");
  assert.equal(tenth[3].title, "$1,250.25 from Acme");
  assert.ok(!Object.values(byDay).flat().some((i) => i.title === "Out of range"), "outside the range is dropped");
  assert.equal(byDay["2026-11-02"].find((i) => i.type === "scan").title, "All businesses in Erie", "weekly scan lands on Mondays");
  assert.ok(!Object.values(byDay).flat().some((i) => i.title === "Paused"), "paused campaigns are hidden");
});

test("calendar data: range queries, money only for managers, brand isolation, contact choices", async () => {
  const c = await import("../lib/calendar.js");
  const crm = await import("../lib/crm.js");
  const lead = await store.createContact("aquila", { name: "Calendar Person", source: "manual" });
  const clientId = await store.createClient("aquila", { name: "Calendar Client" });
  const when = crm.localInputToIso("2031-05-12T10:30");
  const m = await store.createMeeting("aquila", { leadId: lead, title: "Intro call", location: "meet", startsAt: when });
  await store.addTask("aquila", lead, { title: "Calendar follow-up", dueOn: "2031-05-14" });
  const project = await store.createProject("aquila", clientId, { name: "Cal project", type: "website", status: "in_progress", quotedCents: 40000 });
  const invoiceId = await store.createInvoiceRow("aquila", { projectId: project, clientId, kind: "full", amountCents: 40000, recipientEmail: "x@example.test", requestId: "cal-req" });
  await store.markInvoiceCreated("aquila", invoiceId, { paypalId: "INV2-CAL-1" });
  await store.applyInvoiceSync("aquila", invoiceId, { status: "SENT", invoiceNumber: "CAL1", viewUrl: null, dueCents: 40000, paidCents: null, dueOn: "2031-05-15" });
  const range = { fromDay: "2031-05-01", toDay: "2031-05-31" };
  const mgr = await store.calendarItems("aquila", { ...range, includeMoney: true });
  assert.ok(mgr.meetings.some((x) => x.id === m));
  assert.ok(mgr.tasks.some((x) => x.title === "Calendar follow-up"));
  assert.equal(mgr.invoices.length, 1);
  const member = await store.calendarItems("aquila", { ...range, includeMoney: false });
  assert.equal(member.invoices.length, 0, "members never receive invoice rows");
  const byDay = c.assembleCalendar(mgr, range.fromDay, range.toDay);
  assert.equal(byDay["2031-05-12"][0].type, "meeting");
  assert.equal(byDay["2031-05-14"][0].type, "task");
  assert.equal(byDay["2031-05-15"][0].type, "invoice");
  const outside = await store.calendarItems("aquila", { fromDay: "2031-06-01", toDay: "2031-06-30", includeMoney: true });
  assert.equal(outside.meetings.length + outside.tasks.length + outside.invoices.length, 0);
  const other = await store.calendarItems("other", { ...range, includeMoney: true });
  assert.equal(other.meetings.length + other.tasks.length + other.invoices.length, 0, "another brand sees nothing");
  const choices = await store.contactChoices("aquila");
  assert.ok(choices.some((x) => x.value === "client:" + clientId && /client/.test(x.label)));
  assert.ok(choices.some((x) => x.value === "lead:" + lead));
  assert.deepEqual(await store.contactChoices("other"), []);
});

test("ics export escapes text, folds long lines, and cannot inject events", async () => {
  const ics = await import("../lib/ics.js");
  assert.equal(ics.escapeText("a,b;c\\d\nline2"), "a\\,b\\;c\\\\d\\nline2");
  const nasty = "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Injected";
  const out = ics.buildIcs([
    { uid: "meeting-1@kestrel", startIso: "2031-05-12T14:30:00.000Z", durationMinutes: 30, summary: nasty, location: "Google Meet", description: "x".repeat(300) + " é".repeat(60), status: "scheduled" },
    { uid: "bad uid;<>\r\n", startIso: "not a date", summary: "skipped" },
    { uid: "meeting-2@kestrel", startIso: "2031-05-13T09:00:00.000Z", summary: "Cancelled", status: "cancelled" },
  ], { now: new Date("2031-01-01T00:00:00Z") });
  const lines = out.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  const whole = out.replace(/\r\n /g, "").split("\r\n"); // unfolded, one entry per real calendar line
  assert.equal(whole.filter((l) => l === "BEGIN:VEVENT").length, 2, "exactly the two valid events, nothing injected");
  assert.equal(whole.filter((l) => l === "END:VEVENT").length, 2);
  assert.ok(whole.some((l) => l.startsWith("SUMMARY:Evil\\nEND:VEVENT")), "the attack text stayed inside one escaped SUMMARY value");
  assert.ok(out.includes("DTSTART:20310512T143000Z"));
  assert.ok(out.includes("DTEND:20310512T150000Z"), "30 minute default");
  assert.ok(out.includes("DTSTAMP:20310101T000000Z"));
  assert.ok(out.includes("STATUS:CANCELLED"));
  assert.ok(!lines.some((l) => l === "SUMMARY:Injected"));
  assert.ok(lines.every((l) => Buffer.byteLength(l, "utf8") <= 75), "every line is folded to 75 bytes");
  assert.ok(lines.filter((l) => l.startsWith("UID:")).every((l) => /^UID:[A-Za-z0-9@._-]*$/.test(l)), "uids are sanitized");
  const unfolded = out.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("é"), "multi-byte characters survive folding intact");
});

// ---------------- website verification (free, Overture Maps) ----------------

test("name and url helpers for matching", async () => {
  const m = await import("../lib/matchsites.js");
  assert.deepEqual(m.nameTokens("Joe's Pizza & Subs, LLC"), ["joes", "pizza", "subs"]);
  assert.equal(m.normName("The Bella Pizza Co."), "bellapizza");
  assert.equal(m.nameSimilarity("Bella Pizza", "bella  pizza!"), 1);
  assert.equal(m.nameSimilarity("The Citizen Pie", "Citizen Pie"), 1, "filler words ignored");
  assert.ok(m.nameSimilarity("Citizen Pie", "Citizen Pie Tremont") >= 0.6 && m.nameSimilarity("Citizen Pie", "Citizen Pie Tremont") < 0.8);
  assert.ok(m.nameSimilarity("Pat's Barber Shop", "Rosa's Nail Salon") < 0.2);
  assert.equal(m.nameSimilarity("", "x"), 0);
  assert.equal(m.digits10("+1 (330) 794-1234"), "3307941234");
  assert.equal(Math.round(m.distanceMeters(41.5, -81.7, 41.5, -81.7)), 0);
  assert.ok(Math.abs(m.distanceMeters(41.5, -81.7, 41.5, -81.6988) - 100) < 5, "about 100 metres");
  assert.equal(m.normalizeUrl("www.example.com/menu"), "https://www.example.com/menu");
  assert.equal(m.normalizeUrl("http://Example.com/#top"), "http://example.com/");
  for (const bad of ["", "javascript:alert(1)", "ftp://x.com", "http://localhost", "https://u:p@x.com", "not a url", "x".repeat(400)]) assert.equal(m.normalizeUrl(bad), null, bad);
  assert.deepEqual(m.bestWebsite({ websites: ["https://facebook.com/x", "joes.com"], socials: [] }), { url: "https://joes.com/", kind: "site" });
  assert.deepEqual(m.bestWebsite({ websites: [], socials: ["https://www.facebook.com/joes"] }), { url: "https://www.facebook.com/joes", kind: "social" });
  assert.equal(m.bestWebsite({ websites: [], socials: [] }), null);
  assert.equal(m.locationOfLead({ search_label: "shops in Cleveland, OH" }), "Cleveland, OH");
  assert.equal(m.locationOfLead({ search_label: "", city: "Akron", region: "OH" }), "Akron, OH");
  assert.equal(m.locationOfLead({}), null);
});

test("matching is conservative: only the same business counts", async () => {
  const { matchLead } = await import("../lib/matchsites.js");
  const cand = (o) => ({ name: "", city: "", phones: [], websites: ["https://x.com"], socials: [], lat: null, lon: null, confidence: 0.8, ...o });
  const lead = { name: "Citizen Pie", city: "Cleveland", phone: "(216) 555-0100", lat: 41.4800, lon: -81.7000 };
  // same phone and name
  assert.equal(matchLead(lead, [cand({ name: "Citizen Pie", phones: ["+12165550100"] })]).how, "phone");
  // same phone, name differs a lot and far away: a shared line is not enough
  assert.equal(matchLead(lead, [cand({ name: "Totally Different Law Firm", phones: ["+12165550100"], lat: 41.9, lon: -81.9 })]), null);
  // same phone, different name but at the same spot: accepted
  assert.equal(matchLead(lead, [cand({ name: "Totally Different Name", phones: ["+12165550100"], lat: 41.4801, lon: -81.7001 })]).how, "phone");
  // name and location
  assert.equal(matchLead(lead, [cand({ name: "The Citizen Pie", lat: 41.4801, lon: -81.7002 })]).how, "name and location");
  // same name but in another part of town (a different branch): rejected
  assert.equal(matchLead(lead, [cand({ name: "Citizen Pie", lat: 41.52, lon: -81.62 })]), null);
  // no coordinates on the lead: fall back to the same city
  const noCoords = { name: "Citizen Pie", city: "Cleveland", phone: "" };
  assert.equal(matchLead(noCoords, [cand({ name: "Citizen Pie", city: "Cleveland" })]).how, "name and city");
  assert.equal(matchLead(noCoords, [cand({ name: "Citizen Pie", city: "Akron" })]), null, "same name, different city");
  assert.equal(matchLead(noCoords, [cand({ name: "Citizen Pie", city: "" })]), null, "no location evidence at all");
  assert.equal(matchLead(noCoords, [cand({ name: "Citizen Pizza Palace", city: "Cleveland" })]), null, "similar but not the same name");
  // the best of several candidates wins, phone first
  const best = matchLead(lead, [
    cand({ name: "Citizen Pie", lat: 41.4801, lon: -81.7001, confidence: 0.9 }),
    cand({ name: "Citizen Pie", phones: ["2165550100"], lat: 41.4801, lon: -81.7001, confidence: 0.5, websites: ["https://right.com"] }),
  ]);
  assert.equal(best.how, "phone");
  assert.deepEqual(best.candidate.websites, ["https://right.com"]);
  assert.equal(matchLead(lead, []), null);
});

test("overture access: release discovery, safe query building, rows", async () => {
  const o = await import("../lib/overture.js");
  const xml = "<ListBucketResult><CommonPrefixes><Prefix>release/2026-09-23.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/2026-10-21.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/2026-09-23.1/</Prefix></CommonPrefixes></ListBucketResult>";
  assert.equal(await o.latestRelease({ fetchImpl: async () => ({ ok: true, text: async () => xml }), env: {} }), "2026-10-21.0");
  assert.equal(await o.latestRelease({ env: { OVERTURE_RELEASE: "2026-01-01.0" } }), "2026-01-01.0", "override, no network");
  await assert.rejects(o.latestRelease({ fetchImpl: async () => ({ ok: false }), env: {} }), /Could not reach/);
  await assert.rejects(o.latestRelease({ fetchImpl: async () => ({ ok: true, text: async () => "<x/>" }), env: {} }), /no data releases/);
  const q = o.buildPlacesQuery("2026-10-21.0", { west: -81.8, east: -81.5, south: 41.3, north: 41.6 });
  assert.ok(q.includes("release/2026-10-21.0/theme=places") && q.includes("BETWEEN -81.8 AND -81.5"));
  assert.throws(() => o.buildPlacesQuery("2026-10-21.0'; DROP TABLE x;--", { west: 0, east: 1, south: 0, north: 1 }), /Bad release/);
  assert.throws(() => o.buildPlacesQuery("2026-10-21.0", { west: "1; DROP", east: 1, south: 0, north: 1 }), /Bad coordinates/);
  assert.throws(() => o.buildPlacesQuery("2026-10-21.0", { west: 999, east: 1, south: 0, north: 1 }), /Bad coordinates/);
  assert.deepEqual(o.expandBox({ south: 1, north: 2, west: 3, east: 4 }, 0.5), { south: 0.5, north: 2.5, west: 2.5, east: 4.5 });
  const row = o.normalizeRow({ name: "X", websites: ["a.com", 5, null], socials: null, phones: ["1"], city: null, lon: "-81.5", lat: 41.5, confidence: "0.7" });
  assert.deepEqual(row.websites, ["a.com"]);
  assert.deepEqual(row.socials, []);
  assert.equal(row.lon, -81.5);
  assert.equal(row.confidence, 0.7);
});

async function seedVerifyLead(name, extra = {}) {
  const place = { place_id: "osm:node/" + name.replace(/\W/g, ""), name, category: "bakery", category_label: "Bakery", address: "", city: "Veriton", region: "VT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website", lat: 41.5, lon: -81.5, ...extra };
  const r = await store.upsertPlace("aquila", place, "shops in Veriton, VT");
  return r.id;
}

test("verification stores what the directory knows and respects people's verdicts", async () => {
  const withSite = await seedVerifyLead("Sunny Bakery Verify");
  const socialOnly = await seedVerifyLead("Social Only Cafe Verify");
  const unknown = await seedVerifyLead("Nobody Knows Us Verify");
  const humanSaidNone = await seedVerifyLead("Human Verdict Verify");
  await store.setSiteCheck("aquila", humanSaidNone, "confirmed_none");
  assert.equal(await store.applyWebsiteVerification("aquila", withSite, { url: "https://sunny.example/", kind: "site", source: "overture" }), "site");
  assert.equal(await store.applyWebsiteVerification("aquila", socialOnly, { url: "https://www.facebook.com/socialonly", kind: "social", source: "overture" }), "social");
  assert.equal(await store.applyWebsiteVerification("aquila", unknown, null), "none");
  assert.equal(await store.applyWebsiteVerification("aquila", humanSaidNone, { url: "https://wrong.example/", kind: "site" }), "site", "returns site but changes nothing");
  const a = await store.getLead("aquila", withSite);
  assert.equal(a.bucket, "has_website");
  assert.equal(a.website, "https://sunny.example/");
  assert.equal(a.website_source, "overture");
  assert.equal(a.site_check, "has_site");
  assert.ok(a.verified_at);
  const b = await store.getLead("aquila", socialOnly);
  assert.equal(b.bucket, "no_website");
  assert.equal(b.website_kind, "social");
  assert.equal((await store.getLead("aquila", unknown)).bucket, "no_website");
  assert.ok((await store.getLead("aquila", unknown)).overture_checked_at, "looked up, so not checked again for a while");
  const h = await store.getLead("aquila", humanSaidNone);
  assert.equal(h.bucket, "no_website", "a person's confirmed verdict is never overridden");
  assert.equal(h.website, "");
  // a rescan must not erase a website the directory found
  await store.upsertPlace("aquila", { place_id: "osm:node/SunnyBakeryVerify", name: "Sunny Bakery Verify", category: "bakery", category_label: "Bakery", address: "", city: "Veriton", region: "VT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website", lat: 41.5, lon: -81.5 }, "shops in Veriton, VT");
  const again = await store.getLead("aquila", withSite);
  assert.equal(again.bucket, "has_website");
  assert.equal(again.website, "https://sunny.example/");
  assert.equal(again.lat, 41.5, "coordinates stored");
});

test("the verification run groups by area, matches, records outcomes, and stays safe", async () => {
  const v = await import("../lib/verify.js");
  const hit = await seedVerifyLead("Alpha Donuts Verify2", { lat: 41.6, lon: -81.6 });
  const miss = await seedVerifyLead("Beta Tacos Verify2", { lat: 41.61, lon: -81.61 });
  const far = await seedVerifyLead("Gamma Grill Verify2", { lat: 41.62, lon: -81.62 });
  const calls = [];
  const geocodeFn = async (loc) => { calls.push(loc); if (loc === "Nowhere, ZZ") throw new Error("not found"); return { box: { south: 41.5, north: 41.7, west: -81.7, east: -81.5 } }; };
  const fetchPlacesFn = async (box) => {
    calls.push("box " + box.south.toFixed(2));
    return [
      { name: "Alpha Donuts Verify2", city: "Veriton", phones: [], websites: ["alphadonuts.example"], socials: [], lat: 41.6001, lon: -81.6001, confidence: 0.9 },
      { name: "Gamma Grill Verify2", city: "Veriton", phones: [], websites: ["gammagrill.example"], socials: [], lat: 41.9, lon: -81.9, confidence: 0.9 }, // same name, other town
    ];
  };
  const progress = [];
  const s = await v.verifyWebsites({ brandId: "aquila", geocodeFn, fetchPlacesFn, onProgress: (p) => progress.push(p.attempted) });
  assert.ok(calls.filter((c) => c === "Veriton, VT").length === 1, "one lookup per area, not per lead");
  assert.equal(s.foundSite >= 1, true);
  assert.equal((await store.getLead("aquila", hit)).website, "https://alphadonuts.example/");
  assert.equal((await store.getLead("aquila", hit)).bucket, "has_website");
  assert.equal((await store.getLead("aquila", miss)).bucket, "no_website", "not in the directory: stays unverified");
  assert.equal((await store.getLead("aquila", far)).bucket, "no_website", "same name far away is a different business");
  assert.ok(progress.length >= 2 && progress[0] === 0);
  // leads already looked up are not looked up again
  const before = calls.length;
  await v.verifyWebsites({ brandId: "aquila", geocodeFn, fetchPlacesFn });
  assert.equal(calls.length, before, "nothing new to check");
  // an area that fails is reported and does not stop the others
  await store.upsertPlace("aquila", { place_id: "osm:node/NoWhereLead", name: "Lost Lead Verify3", category: "bakery", category_label: "Bakery", address: "", city: "X", region: "ZZ", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }, "shops in Nowhere, ZZ");
  const bad = await v.verifyWebsites({ brandId: "aquila", geocodeFn, fetchPlacesFn });
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /Nowhere, ZZ/);
  // deadline
  await seedVerifyLead("Late Lead Verify4");
  await store.upsertPlace("aquila", { place_id: "osm:node/LateLead2", name: "Late Two Verify4", category: "bakery", category_label: "Bakery", address: "", city: "Lateville", region: "LV", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }, "shops in Lateville, LV");
  const late = await v.verifyWebsites({ brandId: "aquila", geocodeFn, fetchPlacesFn, deadlineMs: -1 });
  assert.match(late.stopped, /minute limit/);
  // brand isolation
  assert.equal((await store.unverifiedLeads("other")).length, 0);
  assert.equal(await store.countUnverified("other"), 0);
});

test("starting a verification records a run and refuses a second at the same time", async () => {
  const v = await import("../lib/verify.js");
  let release;
  const gate = new Promise((r) => { release = r; });
  const verify = async ({ onProgress }) => { await onProgress({ areas: 3, attempted: 1, checked: 10, foundSite: 4, notFound: 6, errors: [], stopped: null }); await gate; return { areas: 3, attempted: 3, checked: 30, foundSite: 12, foundSocial: 1, notFound: 17, errors: [], stopped: null }; };
  const r1 = await v.startVerification({ brandId: "aquila", verify });
  assert.ok(r1.runId);
  const r2 = await v.startVerification({ brandId: "aquila", verify });
  assert.ok(r2.skipped, "no second check while one is running");
  assert.equal((await store.runningVerification("aquila")).id, r1.runId);
  release();
  await r1.done;
  const run = (await store.listRuns("aquila")).find((x) => x.id === r1.runId);
  assert.equal(run.status, "done");
  assert.equal(run.trigger, "verify");
  assert.equal(run.campaign_name, "Website verification");
  assert.equal(run.found, 30);
  assert.equal(run.has_website, 12);
  assert.equal(await store.runningVerification("aquila"), null);
  const failed = await v.startVerification({ brandId: "aquila", verify: async () => { throw new Error("duckdb missing"); } });
  await failed.done;
  assert.equal((await store.listRuns("aquila")).find((x) => x.id === failed.runId).status, "error");
});

// ---------------- website quality audit (free) ----------------

const GOOD_HTML = `<!doctype html><html lang="en"><head><title>Sunny Bakery | Fresh bread in Cleveland</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Family run bakery in Cleveland making fresh bread, pastries and custom cakes every morning since 1995.">
<meta property="og:title" content="Sunny Bakery"><meta property="og:image" content="/og.png">
<script type="application/ld+json">{"@type":"LocalBusiness","name":"Sunny Bakery"}</script></head>
<body><h1>Sunny Bakery</h1><img src="a.jpg" alt="Loaves"><a href="tel:+12165550100">Call</a><footer>&copy; ${new Date().getFullYear()} Sunny Bakery</footer></body></html>`;
const BAD_HTML = `<html><head></head><body><center><font size=3>Welcome</font></center><marquee>Sale</marquee>
<table><tr><td><img src="a.gif"></td></tr></table><table></table><table></table><table></table><img src="b.gif">
<p>Copyright 2009 Old Shop</p></body></html>`;

test("the audit never touches private network addresses", async () => {
  const a = await import("../lib/audit.js");
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"]) assert.equal(a.isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(a.isPrivateAddress(ip), false, ip);
  await assert.rejects(a.fetchPage("http://127.0.0.1:1/"), { code: "EBLOCKED" });
  await assert.rejects(a.fetchPage("http://169.254.169.254/latest/meta-data/"), { code: "EBLOCKED" });
  await assert.rejects(a.fetchPage("ftp://example.com/"), { code: "EPROTO" });
  // a name that resolves to a private address is refused at connection time
  await assert.rejects(a.fetchPage("http://localhost:1/"), { code: "EBLOCKED" });
  const r = await a.auditSite("http://localhost:1/");
  assert.equal(r.status, "blocked");
  assert.equal(r.score, null);
});

test("the audit fetcher follows redirects but checks every hop, and reads real pages", async () => {
  const a = await import("../lib/audit.js");
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    if (req.url === "/hop") { res.writeHead(302, { location: "http://169.254.169.254/x" }); res.end(); }
    else if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); }
    else if (req.url === "/big") { res.writeHead(200, { "content-type": "text/html" }); res.end("x".repeat(2_000_000)); }
    else if (req.url === "/deny") { res.writeHead(403); res.end("no"); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end(GOOD_HTML); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const allowLocal = { lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) };
  try {
    const ok = await a.fetchPage(`http://localhost:${port}/`, allowLocal);
    assert.equal(ok.status, 200);
    assert.ok(ok.html.includes("Sunny Bakery") && ok.ms >= 0 && ok.bytes > 100);
    await assert.rejects(a.fetchPage(`http://localhost:${port}/hop`, allowLocal), { code: "EBLOCKED" });
    await assert.rejects(a.fetchPage(`http://localhost:${port}/loop`, allowLocal), { code: "EREDIRECT" });
    await assert.rejects(a.fetchPage(`http://localhost:${port}/big`, allowLocal), { code: "ETOOBIG" });
    const denied = await a.auditSite(`http://localhost:${port}/deny`, { fetchPageFn: (u) => a.fetchPage(u, allowLocal), psiFn: async () => null });
    assert.equal(denied.status, "blocked");
    assert.equal(denied.score, null, "a site that refuses robots is not scored");
    const scored = await a.auditSite(`http://localhost:${port}/`, { fetchPageFn: (u) => a.fetchPage(u, allowLocal), psiFn: async () => null });
    assert.equal(scored.status, "ok");
    assert.ok(scored.score >= 85, "good page over plain http loses only the https points: " + scored.score);
  } finally {
    server.close();
  }
});

test("scoring: a well built page scores high, an old one low, and reasons say why", async () => {
  const a = await import("../lib/audit.js");
  const good = a.analyzeHtml({ html: GOOD_HTML, finalUrl: "https://sunnybakery.example/", ms: 600, bytes: 4000 });
  assert.equal(good.score, 100);
  assert.equal(good.checks.reduce((n, c) => n + c.max, 0), 100, "weights add up to 100");
  const bad = a.analyzeHtml({ html: BAD_HTML, finalUrl: "http://oldshop.example/", ms: 7000, bytes: 1_200_000 }, { year: 2026 });
  assert.ok(bad.score <= 20, "old page scores low: " + bad.score);
  const reasons = a.reasonsFrom(bad.checks);
  assert.ok(reasons.length >= 4 && reasons.length <= 5);
  assert.ok(reasons.some((r) => /mobile layout|tiny desktop/.test(r)));
  assert.ok(reasons.some((r) => /older page code/.test(r)));
  assert.deepEqual(a.reasonsFrom(good.checks), []);
  // pieces
  const mid = a.analyzeHtml({ html: GOOD_HTML.replace(/<meta name="viewport"[^>]*>/, ""), finalUrl: "https://x.example/", ms: 600, bytes: 4000 });
  assert.equal(mid.score, 85, "losing the viewport costs exactly its 15 points");
  const noImgAlt = a.analyzeHtml({ html: GOOD_HTML.replace('alt="Loaves"', ""), finalUrl: "https://x.example/", ms: 600, bytes: 4000 });
  assert.equal(noImgAlt.checks.find((c) => c.id === "alt").points, 0);
  const emptyAlt = a.analyzeHtml({ html: GOOD_HTML.replace('alt="Loaves"', 'alt=""'), finalUrl: "https://x.example/", ms: 600, bytes: 4000 });
  assert.equal(emptyAlt.checks.find((c) => c.id === "alt").points, 8, "empty alt is valid for decoration");
  assert.equal(a.analyzeHtml({ html: "", finalUrl: "", ms: 0, bytes: 0 }).score >= 0, true, "empty input does not throw");
});

test("audit outcomes: unreachable and blocked sites are never scored; PageSpeed is optional", async () => {
  const a = await import("../lib/audit.js");
  const page = (o) => async () => ({ status: 200, html: GOOD_HTML, finalUrl: "https://x.example/", ms: 500, bytes: 4000, ...o });
  const none = async () => null;
  const dns = await a.auditSite("https://gone.example/", { fetchPageFn: async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); }, psiFn: none });
  assert.equal(dns.status, "unreachable");
  assert.equal(dns.score, null);
  const e404 = await a.auditSite("https://x.example/", { fetchPageFn: page({ status: 404 }), psiFn: none });
  assert.equal(e404.status, "unreachable");
  for (const status of [401, 403, 429]) assert.equal((await a.auditSite("https://x.example/", { fetchPageFn: page({ status }), psiFn: none })).status, "blocked");
  const plain = await a.auditSite("https://x.example/", { fetchPageFn: page(), psiFn: none });
  assert.equal(plain.score, 100);
  const withPsi = await a.auditSite("https://x.example/", { fetchPageFn: page(), psiFn: async () => ({ performance: 40, accessibility: 60, bestPractices: 80, seo: 80 }) });
  assert.equal(withPsi.score, 83, "average of the page checks (100) and Google's scores (65)");
  assert.match(withPsi.reasons.join(" "), /speed at 40/);
  assert.match(withPsi.reasons.join(" "), /accessibility at 60/);
  // PageSpeed: no key means no call; a failing or odd response means null
  let called = 0;
  assert.equal(await a.pageSpeed("https://x.example/", { key: "", fetchImpl: async () => { called++; } }), null);
  assert.equal(called, 0);
  assert.equal(await a.pageSpeed("https://x.example/", { key: "k", fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await a.pageSpeed("https://x.example/", { key: "k", fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await a.pageSpeed("https://x.example/", { key: "k", fetchImpl: async () => ({ ok: true, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.5 } } } }) }) }), null, "partial data is not used");
  let seen;
  const full = await a.pageSpeed("https://x.example/a b", { key: "KEY", fetchImpl: async (u) => { seen = String(u); return { ok: true, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.91 }, accessibility: { score: 1 }, "best-practices": { score: 0.8 }, seo: { score: 0.9 } } } }) }; } });
  assert.deepEqual(full, { performance: 91, accessibility: 100, bestPractices: 80, seo: 90 });
  assert.ok(seen.includes("strategy=mobile") && seen.includes("key=KEY") && seen.includes("category=seo"));
});

async function seedAuditLead(name, website, extra = {}) {
  const r = await store.upsertPlace("aquila", { place_id: "osm:node/" + name.replace(/\W/g, ""), name, category: "bakery", category_label: "Bakery", address: "", city: "Auditville", region: "AV", phone: "", website, website_kind: website ? "site" : "none", maps_url: "", bucket: website ? "has_website" : "no_website", ...extra }, "shops in Auditville, AV");
  return r.id;
}

test("audit results are stored; redesign targets list the weak sites worst first", async () => {
  const rd = await import("../lib/redesign.js");
  assert.deepEqual(rd.THRESHOLDS, [50, 60, 70, 80]);
  assert.equal(rd.parseThreshold("70"), 70);
  for (const bad of [undefined, "", "abc", "65", "-1", "70; DROP", "9999"]) assert.equal(rd.parseThreshold(bad), 60, String(bad));
  const weak = await seedAuditLead("Weak Site Audit", "https://weak.example/");
  const middling = await seedAuditLead("Middling Site Audit", "https://mid.example/");
  const strong = await seedAuditLead("Strong Site Audit", "https://strong.example/");
  const blocked = await seedAuditLead("Blocked Site Audit", "https://blocked.example/");
  const gone = await seedAuditLead("Gone Site Audit", "https://gone.example/");
  const noSite = await seedAuditLead("No Site Audit", "");
  const social = await seedAuditLead("Social Site Audit", "https://www.facebook.com/x", { website_kind: "social", bucket: "no_website" });
  const dnc = await seedAuditLead("Optout Site Audit", "https://optout.example/");
  await store.setLeadStatus("aquila", dnc, "do_not_contact");
  const queued = (await store.leadsToAudit("aquila")).map((l) => l.id);
  for (const id of [weak, middling, strong, blocked, gone]) assert.ok(queued.includes(id));
  for (const id of [noSite, social, dnc]) assert.ok(!queued.includes(id), "only real, contactable websites are audited");
  await store.applyAudit("aquila", weak, { status: "ok", score: 31.4, checks: [], reasons: ["No mobile layout setting."], psi: null });
  await store.applyAudit("aquila", middling, { status: "ok", score: 66, checks: [], reasons: ["Slow."], psi: null });
  await store.applyAudit("aquila", strong, { status: "ok", score: 93, checks: [], reasons: [], psi: null });
  await store.applyAudit("aquila", blocked, { status: "blocked", score: 50, reasons: ["blocked"] });
  await store.applyAudit("aquila", gone, { status: "unreachable", score: null, reasons: ["gone"] });
  await store.applyAudit("aquila", noSite, { status: "ok", score: 1, reasons: [] });
  assert.equal((await store.getLead("aquila", noSite)).audit_score, null, "a lead without a website cannot be scored");
  assert.equal((await store.getLead("aquila", blocked)).audit_score, null, "blocked sites never carry a score");
  assert.equal((await store.getLead("aquila", weak)).audit_score, 31);
  const queuedAfter = (await store.leadsToAudit("aquila")).map((l) => l.id);
  assert.ok(!queuedAfter.includes(weak) && !queuedAfter.includes(gone), "audited recently, not repeated");
  const below60 = (await store.redesignTargets("aquila", 60)).map((l) => l.id);
  assert.deepEqual(below60.filter((id) => [weak, middling, strong, blocked, gone].includes(id)), [weak]);
  const below70 = (await store.redesignTargets("aquila", 70)).map((l) => l.id).filter((id) => [weak, middling, strong, blocked, gone].includes(id));
  assert.deepEqual(below70, [weak, middling], "worst first");
  assert.equal(await store.countRedesignTargets("aquila", 70) >= 2, true);
  assert.equal((await store.redesignTargets("other", 100)).length, 0, "brand isolation");
  assert.equal((await store.auditCounts("other")).ok, 0);
  const c = await store.auditCounts("aquila");
  assert.ok(c.ok >= 3 && c.blocked >= 1 && c.unreachable >= 1);
  // a lost, won or opted-out lead is not a redesign target
  await store.setStage("aquila", weak, "won");
  assert.ok(!(await store.redesignTargets("aquila", 100)).some((l) => l.id === weak));
});

test("the audit run records progress, survives one bad site, and refuses a second at the same time", async () => {
  const ar = await import("../lib/auditrun.js");
  const a = await seedAuditLead("Run Site One Audit2", "https://one.example/");
  const b = await seedAuditLead("Run Site Two Audit2", "https://two.example/");
  const c = await seedAuditLead("Run Site Three Audit2", "https://three.example/");
  const seen = [];
  const auditFn = async (url) => {
    seen.push(url);
    if (url.includes("two.")) throw new Error("boom");
    if (url.includes("three.")) return { status: "unreachable", score: null, checks: [], reasons: ["gone"], psi: null };
    return { status: "ok", score: 55, checks: [], reasons: ["Slow."], psi: null };
  };
  const s = await ar.auditSites({ brandId: "aquila", auditFn, concurrency: 2 });
  assert.ok(seen.includes("https://one.example/") && seen.includes("https://two.example/"));
  assert.equal(s.errors.length >= 1, true);
  assert.match(s.errors.join(" "), /Run Site Two/);
  assert.equal((await store.getLead("aquila", a)).audit_score, 55);
  assert.equal((await store.getLead("aquila", b)).audit_status, null, "a crash leaves the lead to be retried");
  assert.equal((await store.getLead("aquila", c)).audit_status, "unreachable");
  const late = await ar.auditSites({ brandId: "aquila", auditFn, deadlineMs: -1 });
  assert.match(late.stopped, /minute limit/);
  // run record and no double start
  let release;
  const gate = new Promise((r) => { release = r; });
  const audit = async ({ onProgress }) => { await onProgress({ total: 5, attempted: 2, scored: 1, unreachable: 1, blocked: 0, errors: [], stopped: null }); await gate; return { total: 5, attempted: 5, scored: 4, unreachable: 1, blocked: 0, errors: [], stopped: null }; };
  const r1 = await ar.startAudit({ brandId: "aquila", audit });
  const r2 = await ar.startAudit({ brandId: "aquila", audit });
  assert.ok(r2.skipped);
  assert.equal((await store.runningAudit("aquila")).id, r1.runId);
  assert.equal(await store.runningVerification("aquila"), null, "audit and verification are separate");
  release();
  await r1.done;
  const run = (await store.listRuns("aquila")).find((x) => x.id === r1.runId);
  assert.equal(run.status, "done");
  assert.equal(run.trigger, "audit");
  assert.equal(run.has_website, 4);
  assert.equal(run.no_website, 1);
  const failed = await ar.startAudit({ brandId: "aquila", audit: async () => { throw new Error("db down"); } });
  await failed.done;
  assert.equal((await store.listRuns("aquila")).find((x) => x.id === failed.runId).status, "error");
});

test("pages built by scripts are not scored (an empty shell would be misjudged)", async () => {
  const a = await import("../lib/audit.js");
  const shell = "<!doctype html><html lang=en><head><title></title><meta name=viewport content='width=device-width'></head><body><div id=\"root\"></div><script src=a.js></script><script src=b.js></script><script src=c.js></script></body></html>";
  const r = await a.auditSite("https://spa.example/", { fetchPageFn: async () => ({ status: 200, html: shell, finalUrl: "https://spa.example/", ms: 300, bytes: 400 }), psiFn: async () => null });
  assert.equal(r.status, "script_built");
  assert.equal(r.score, null);
  assert.match(r.reasons[0], /built with scripts/);
  // a small but real page is still scored
  const tiny = await a.auditSite("https://tiny.example/", { fetchPageFn: async () => ({ status: 200, html: GOOD_HTML, finalUrl: "https://tiny.example/", ms: 300, bytes: 400 }), psiFn: async () => null });
  assert.equal(tiny.status, "ok");
});

test("chains, franchise pages and directory listings are spotted; local businesses are not", async () => {
  const c = await import("../lib/chains.js");
  const skip = (name, website) => c.skipReason({ name, website });
  assert.equal(skip("Starbucks", "https://www.starbucks.com/store-locator/store/1").status, "chain");
  assert.equal(skip("The Great Clips", "https://x.example/").status, "chain");
  assert.equal(skip("Great Clips Akron", "https://x.example/").status, "chain", "longer chain names can have a place after them");
  assert.equal(skip("Tim Hortons", "https://locations.timhortons.com/oh/akron/12").status, "chain");
  assert.equal(skip("Unknown Franchise", "https://corp.example/locations/akron-123").status, "chain");
  assert.equal(skip("Wingstop", "https://wingstop.com/").status, "chain");
  assert.equal(skip("Shell", "https://x.weebly.com/").status, "chain");
  assert.equal(skip("Subway", "https://subshop.example/").status, "chain");
  for (const url of ["https://www.groupon.com/biz/akron/katrinas", "https://book.squareup.com/appointments/abc", "https://www.yelp.com/biz/x", "https://order.toasttab.com/online/x"]) assert.equal(skip("Local Place", url).status, "listing", url);
  assert.equal(skip("Local Place", "https://notgroupon.com/"), null, "a similar looking host is not a listing site");
  // things that must NOT be skipped
  assert.equal(skip("Citizen Pie", "https://www.citizenpie.com/"), null, "a local business with several listings is still a prospect");
  assert.equal(skip("Citizen Pie", "https://www.citizenpie.com/"), null);
  assert.equal(skip("Target Practice Archery", "https://archery.example/"), null, "an everyday word at the start of a local name is not a chain");
  assert.equal(skip("Shelley's Shellfish House", "https://shelleys.example/"), null, "partial words do not match");
  assert.equal(skip("Sub Shop", "https://subshop.example/"), null);
  assert.equal(skip("Emily's", "https://emilyscleveland.com/american-food-order-online/restaurants/bba97770/31137"), null, "an ordering page on a business's own domain is audited");
  assert.equal(skip("Mystery Salon", "https://corp.example/salons/akron-123"), null);
  assert.equal(skip("", "garbage"), null);
});

test("the audit run skips chains and listings without any request", async () => {
  const ar = await import("../lib/auditrun.js");
  const chainLead = await seedAuditLead("Starbucks", "https://www.starbucks.com/store-locator/store/42");
  const listingLead = await seedAuditLead("Listing Only Salon Audit3", "https://www.groupon.com/biz/akron/listing-only-salon");
  const own = await seedAuditLead("Independent Audit3", "https://independent3.example/");
  const requested = [];
  const s = await ar.auditSites({ brandId: "aquila", auditFn: async (u) => { requested.push(u); return { status: "ok", score: 90, checks: [], reasons: [], psi: null }; } });
  assert.ok(!requested.some((u) => u.includes("starbucks") || u.includes("groupon")), "no request to a chain or directory site");
  assert.ok(requested.includes("https://independent3.example/"));
  assert.ok(s.chains >= 1 && s.listings >= 1);
  assert.equal((await store.getLead("aquila", chainLead)).audit_status, "chain");
  assert.equal((await store.getLead("aquila", listingLead)).audit_status, "listing");
  assert.equal((await store.getLead("aquila", chainLead)).audit_score, null);
  assert.equal((await store.getLead("aquila", own)).audit_score, 90);
  const targets = await store.redesignTargets("aquila", 101);
  assert.ok(!targets.some((l) => l.id === chainLead || l.id === listingLead), "skipped sites are never redesign targets");
  const counts = await store.auditCounts("aquila");
  assert.ok(counts.chain >= 1 && counts.listing >= 1);
});


test("the waiting count only includes leads a check would actually look up", async () => {
  const fresh = await seedVerifyLead("Waiting Count Lead Verify5");
  const before = await store.countWaitingForLookup("aquila");
  assert.ok(before >= 1);
  assert.ok((await store.countUnverified("aquila")) >= before);
  await store.applyWebsiteVerification("aquila", fresh, null);
  assert.equal(await store.countWaitingForLookup("aquila"), before - 1, "looked up and not found: no longer waiting, still unverified");
  assert.equal(await store.countWaitingForLookup("other"), 0);
});

// ---------------- redesign concept and email (step 3) ----------------

const scoredLead = (o = {}) => ({
  name: "Old Site Bakery", city: "Akron", phone: "(330) 555-0100", bucket: "has_website", status: "new", website: "https://oldsite.example/",
  audit_status: "ok", audit_score: 41, audited_at: "2026-11-05T15:30:00.000Z",
  audit_json: JSON.stringify({ reasons: ["No mobile layout setting, so phones usually show a tiny desktop page.", "Does not load over HTTPS, so browsers warn visitors it is not secure.", "No phone link, email link or form found on the home page.", "Fourth reason that should not appear."] }),
  ...o,
});

test("redesign helpers: who qualifies, what the check said, dates", async () => {
  const r = await import("../lib/redesign.js");
  assert.equal(r.isRedesignLead(scoredLead()), true);
  assert.equal(r.isRedesignLead(scoredLead({ audit_status: "blocked", audit_score: null })), false);
  assert.equal(r.isRedesignLead(scoredLead({ audit_score: null })), false, "no score, no redesign lead");
  assert.equal(r.isRedesignLead(scoredLead({ audit_status: "chain" })), false);
  assert.equal(r.isRedesignLead(scoredLead({ bucket: "no_website" })), false);
  assert.equal(r.isRedesignLead(scoredLead({ status: "do_not_contact" })), false);
  assert.equal(r.isRedesignLead(scoredLead({ audit_score: 0 })), true, "a score of zero is still a score");
  assert.equal(r.isRedesignLead(null), false);
  const a = r.auditOf(scoredLead());
  assert.equal(a.score, 41);
  assert.equal(a.reasons.length, 4);
  assert.equal(a.website, "https://oldsite.example/");
  assert.equal(r.auditOf(scoredLead({ audit_json: "{not json" })).reasons.length, 0, "bad stored data does not throw");
  assert.equal(r.auditOf(scoredLead({ bucket: "no_website" })), null);
  assert.equal(r.longDate("2026-11-05T23:59:00.000Z"), "November 5, 2026", "UTC day, not the reader's");
  assert.equal(r.longDate("garbage"), "");
});

test("the redesign email says what was checked, uses only measured findings, and keeps every guardrail", async () => {
  const { buildRedesignDraft, UNSUB_TOKEN } = await import("../lib/email.js");
  const brand = getBrand("aquila");
  const lead = scoredLead();
  const { subject, body } = buildRedesignDraft({ lead, brand, mockupLink: "https://x.test/m/abc", bookingLink: "https://cal.com/x" });
  assert.equal(subject, "A few ideas for the Old Site Bakery website");
  assert.ok(body.includes("home page of https://oldsite.example/"));
  assert.ok(body.includes("1. No mobile layout setting"));
  assert.ok(body.includes("3. No phone link"));
  assert.ok(!body.includes("Fourth reason"), "at most three findings");
  assert.ok(body.includes("automated read of your home page on November 5, 2026"));
  assert.ok(body.includes("It can miss things"), "limits of the check are stated");
  assert.ok(body.includes("Nothing was copied from your current site"));
  assert.ok(body.includes("https://x.test/m/abc") && body.includes("pick a time to talk here: https://cal.com/x"));
  assert.ok(body.includes(UNSUB_TOKEN) && body.includes("reply with the word STOP"));
  assert.ok(body.includes(brand.mailingAddress));
  assert.ok(!/[\u2013\u2014]/.test(body), "no dash punctuation");
  assert.ok(!/\b(abandoned|terrible|awful|broken|outdated)\b/i.test(body), "no insults");
  assert.ok(!/\[\[/.test(body.replace(brand.mailingAddress, "")));
  assert.throws(() => buildRedesignDraft({ lead: scoredLead({ audit_status: null, audit_score: null }), brand, mockupLink: "x" }), /no website quality check/);
  assert.throws(() => buildRedesignDraft({ lead: scoredLead({ bucket: "no_website" }), brand, mockupLink: "x" }), /no website quality check/);
  const noPhone = buildRedesignDraft({ lead: scoredLead({ phone: "" }), brand, mockupLink: "x" }).body;
  assert.ok(noPhone.includes("your business name, category, and city,") || noPhone.includes("your business name, category, and city)"));
  assert.ok(!noPhone.includes("pick a time"), "booking line only when a link is saved");
});

test("the audit wording is never harsh about a business", async () => {
  const a = await import("../lib/audit.js");
  const old = a.analyzeHtml({ html: "<html><body><p>Copyright 2009 Old Shop</p></body></html>", finalUrl: "http://x.example/", ms: 500, bytes: 100 }, { year: 2026 });
  const fresh = old.checks.find((c) => c.id === "fresh").note;
  assert.match(fresh, /may look out of date/);
  assert.ok(!/abandon/i.test(JSON.stringify(old.checks)));
});

test("redesign drafts: only scored sites below the cutoff without a draft, skipping skipped leads", async () => {
  const mk = async (name, score, extra = {}) => {
    const id = await seedAuditLead(name, `https://${name.replace(/\W/g, "").toLowerCase()}.example/`);
    await store.applyAudit("aquila", id, { status: "ok", score, checks: [], reasons: ["Slow."], psi: null });
    if (extra.skip) await store.setLeadStatus("aquila", id, "skipped");
    return id;
  };
  const low = await mk("Draftable Low Redesign4", 20);
  const drafted = await mk("Already Drafted Redesign4", 25);
  const skipped = await mk("Skipped Lead Redesign4", 22, { skip: true });
  const high = await mk("High Score Redesign4", 90);
  await store.saveDraft("aquila", drafted, { subject: "s", body: "b" });
  const ids = (await store.redesignNeedingDraft("aquila", 60)).map((l) => l.id);
  assert.ok(ids.includes(low));
  assert.ok(!ids.includes(drafted) && !ids.includes(skipped) && !ids.includes(high));
  assert.equal((await store.redesignNeedingDraft("other", 100)).length, 0, "brand isolation");
  const rows = await store.redesignTargets("aquila", 60);
  assert.equal(rows.find((l) => l.id === drafted).draft_status, "draft", "the list shows existing draft status");
  assert.equal(rows.find((l) => l.id === low).draft_status, null);
  assert.ok(ids.length <= 200 && (await store.redesignNeedingDraft("aquila", 60, 1)).length <= 1, "limit respected");
});

test("every sentence the audit can produce is safe to put in an email to the business", async () => {
  const a = await import("../lib/audit.js");
  const worst = a.analyzeHtml({ html: "<html><center><font>x</font></center><marquee>m</marquee><frameset></frameset><embed type=application/x-shockwave-flash><table></table><table></table><table></table><table></table><img src=a><p>Copyright 2001</p></html>", finalUrl: "http://x.example/", ms: 9000, bytes: 2_000_000 }, { year: 2026 });
  const text = worst.checks.map((c) => c.note).join(" ");
  assert.ok(!/\b(abandoned|terrible|awful|broken|outdated|bad|ugly|useless|amateur)\b/i.test(text), text);
  assert.ok(!/[\u2013\u2014]/.test(text), "no dash punctuation");
});

// ---------------- closed businesses ----------------

test("a closed business drops out of lists, checks, redesign targets and outreach, and can be reopened", async () => {
  const lf = await import("../lib/leadfilters.js");
  const { isRedesignLead } = await import("../lib/redesign.js");
  const noSite = await seedVerifyLead("Closed Bakery Verify6");
  const withSite = await seedAuditLead("Closed Site Audit6", "https://closedsite6.example/");
  await store.applyAudit("aquila", withSite, { status: "ok", score: 10, checks: [], reasons: ["Slow."], psi: null });
  await store.saveDraft("aquila", noSite, { subject: "s", body: "b" });
  await store.setDraftStatus("aquila", noSite, "approved");
  const openFilter = lf.parseFilters({ site: "any" });
  const closedFilter = lf.parseFilters({ site: "any", open: "closed" });
  const idsOf = async (f) => (await store.searchLeads("aquila", f, { limit: 5000 })).map((l) => l.id);
  assert.ok((await idsOf(openFilter)).includes(noSite));
  const unverifiedBefore = await store.countUnverified("aquila");
  const waitingBefore = await store.countWaitingForLookup("aquila");
  const statsBefore = await store.stats("aquila");

  assert.equal(await store.setClosed("other", noSite, true), false, "another brand cannot close it");
  assert.equal((await store.getLead("aquila", noSite)).closed_at, null);
  assert.equal(await store.setClosed("aquila", noSite, true), true);
  assert.equal(await store.setClosed("aquila", withSite, true), true);

  assert.ok(!(await idsOf(openFilter)).includes(noSite), "hidden from the default list");
  assert.ok((await idsOf(closedFilter)).includes(noSite) && (await idsOf(closedFilter)).includes(withSite), "shown under Closed businesses");
  assert.equal(await store.countUnverified("aquila"), unverifiedBefore - 1);
  assert.equal(await store.countWaitingForLookup("aquila"), waitingBefore - 1);
  assert.ok(!(await store.unverifiedLeads("aquila")).some((l) => l.id === noSite), "no website lookup for a closed business");
  assert.ok(!(await store.leadsToAudit("aquila")).some((l) => l.id === withSite));
  assert.ok(!(await store.redesignTargets("aquila", 101)).some((l) => l.id === withSite), "not a redesign target");
  assert.ok(!(await store.redesignNeedingDraft("aquila", 101)).some((l) => l.id === withSite));
  assert.ok(!(await store.leadsNeedingDraft("aquila")).some((l) => l.id === noSite));
  assert.ok(!(await store.draftableInFilter("aquila", closedFilter)).some((l) => l.id === noSite), "bulk drafting never reaches closed businesses, even from the Closed list");
  const st = await store.stats("aquila");
  assert.ok(st.noWebsite < statsBefore.noWebsite + 1 && st.noWebsite <= statsBefore.noWebsite, "overview counts skip closed businesses");
  assert.equal((await store.getDraftByLead("aquila", noSite)).status, "rejected", "an unsent draft cannot go out");
  const lead = await store.getLead("aquila", noSite);
  assert.ok(lead.closed_at);
  assert.equal(isRedesignLead(await store.getLead("aquila", withSite)), false);
  const brand = getBrand("aquila");
  const problems = await sendProblems({ lead, draft: await store.getDraftByLead("aquila", noSite), brand, sentToday: 0 });
  assert.ok(problems.some((p) => /closed/.test(p)), "sending is blocked");
  const timeline = await store.listActivities("aquila", noSite);
  assert.ok(timeline.some((a) => /closed/i.test(a.body)), "the timeline records it");

  // a rescan of the same place must not quietly reopen it
  await store.upsertPlace("aquila", { place_id: "osm:node/ClosedBakeryVerify6", name: "Closed Bakery Verify6", category: "bakery", category_label: "Bakery", address: "", city: "Veriton", region: "VT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }, "shops in Veriton, VT");
  assert.ok((await store.getLead("aquila", noSite)).closed_at, "still closed after a rescan");

  // reopening puts it back
  assert.equal(await store.setClosed("aquila", noSite, false), true);
  assert.ok((await idsOf(openFilter)).includes(noSite));
  assert.equal((await store.getLead("aquila", noSite)).closed_at, null);
  assert.equal(await store.setClosed("aquila", 99999999, true), false, "unknown lead");
});

test("the Open and Closed filter is a button value that survives links and rejects junk", async () => {
  const lf = await import("../lib/leadfilters.js");
  assert.equal(lf.parseFilters({}).open, "open");
  assert.equal(lf.parseFilters({ open: "closed" }).open, "closed");
  assert.equal(lf.parseFilters({ open: "1; DROP TABLE leads" }).open, "open");
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({}), {}), "/leads", "default adds nothing to the link");
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({}), { open: "closed" }), "/leads?open=closed");
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({ open: "closed" }), { site: "has" }), "/leads?site=has&open=closed");
});

// ---------------- navigation, next step, theme ----------------

test("the menu follows the order of the work and highlights the right page", async () => {
  const nav = await import("../lib/nav.js");
  const all = nav.NAV_GROUPS.flatMap((g) => g.items);
  assert.deepEqual(nav.NAV_GROUPS.map((g) => g.key), ["home", "find", "reach", "follow", "deliver", "settings"], "find, reach out, follow up, deliver");
  assert.ok(all.length <= 11, "a short menu, not thirteen links");
  assert.equal(new Set(all.map((i) => i.href)).size, all.length, "no page appears twice");
  const active = (p) => all.filter((i) => nav.isActive(i, p)).map((i) => i.label);
  assert.deepEqual(active("/"), ["Scan areas"], "the root only matches itself");
  assert.deepEqual(active("/today"), ["Today"]);
  assert.deepEqual(active("/campaigns/new"), ["Scan areas"]);
  assert.deepEqual(active("/leads"), ["Prospects"]);
  assert.deepEqual(active("/leads/42"), ["Prospects"]);
  assert.deepEqual(active("/redesign"), ["Prospects"], "redesign targets live under Prospects");
  assert.deepEqual(active("/meetings"), ["Calendar"], "meetings live under Calendar");
  assert.deepEqual(active("/invoices"), ["Clients and money"]);
  for (const p of ["/connections", "/users", "/audit", "/optouts", "/account", "/settings"]) assert.deepEqual(active(p), ["Settings"], p);
  assert.deepEqual(active("/leadsX"), [], "a longer word is not a match");
  assert.deepEqual(active(""), []);
  // every page named in the menu or in Setup is reachable from it
  for (const s of nav.SETUP_ITEMS) assert.ok(all.some((i) => nav.isActive(i, s.href)), s.href);
  assert.ok(nav.SETUP_ITEMS.some((s) => !s.manager) && nav.SETUP_ITEMS.some((s) => s.manager));
  assert.equal(nav.initialsOf("Steven Brown"), "SB");
  assert.equal(nav.initialsOf("  madonna "), "M");
  assert.equal(nav.initialsOf(""), "?");
  assert.equal(nav.initialsOf(null), "?");
});

test("the theme is exactly light or dark, whatever the cookie says", async () => {
  const t = await import("../lib/theme.js");
  assert.equal(t.parseTheme("dark"), "dark");
  for (const v of ["light", "", undefined, null, "DARK", "dark; x", "<script>", 1]) assert.equal(t.parseTheme(v), "light", String(v));
  assert.equal(t.THEME_COOKIE, "ks_theme");
});

test("next step: people first, then drafts, then checks, and never the page you are on", async () => {
  const n = await import("../lib/nextstep.js");
  const base = { dueNow: 0, review: 0, approved: 0, lookups: 0, unscored: 0 };
  assert.deepEqual(n.pickSteps(base), []);
  assert.equal(n.pickNext(base).key, "scan", "nothing waiting: suggest finding more");
  assert.equal(n.pickNext({ ...base, unscored: 4, lookups: 2, review: 3, dueNow: 1 }).key, "followups", "people waiting on you come first");
  assert.deepEqual(n.pickSteps({ dueNow: 1, review: 3, approved: 2, lookups: 2, unscored: 4 }).map((s) => s.key), ["followups", "review", "send", "lookup", "score"]);
  assert.equal(n.pickNext({ ...base, lookups: 2, unscored: 4 }).key, "lookup", "check who has a site before scoring sites");
  assert.equal(n.pickNext({ ...base, review: 3 }, "/queue").key, "scan", "a step pointing at this page is skipped");
  assert.equal(n.pickNext({ ...base, review: 3, lookups: 1 }, "/queue").key, "lookup");
  const one = n.pickNext({ ...base, review: 1 });
  assert.equal(one.text, "1 draft is waiting for your review");
  assert.equal(n.pickNext({ ...base, review: 2 }).text, "2 drafts are waiting for your review");
  assert.equal(n.pickNext({ ...base, lookups: 1 }).text, "1 business needs a website check");
  assert.equal(n.pickNext({ ...base, unscored: 1 }).text, "1 website is waiting to be scored");
  for (const s of n.pickSteps({ dueNow: 5, review: 5, approved: 5, lookups: 5, unscored: 5 })) {
    assert.ok(s.href.startsWith("/") && s.cta && s.icon);
    assert.ok(!/[\u2013\u2014]/.test(s.text), "no dash punctuation");
  }
});

test("next step counts come from real data and stay inside the brand", async () => {
  const n = await import("../lib/nextstep.js");
  const { todayStr } = await import("../lib/crm.js");
  const c = await n.nextStepCounts("aquila", todayStr());
  for (const k of ["dueNow", "review", "approved", "lookups", "unscored"]) assert.ok(Number.isInteger(c[k]) && c[k] >= 0, k);
  assert.equal(c.backupDue, false, "nobody is nagged about backups unless the page asks");
  const other = await n.nextStepCounts("other", todayStr());
  assert.deepEqual(other, { dueNow: 0, review: 0, approved: 0, lookups: 0, unscored: 0, dealsOverdue: 0, backupDue: false }, "another brand sees nothing of ours");
  // a lead with a follow-up due today shows up
  const id = await seedVerifyLead("Next Step Lead Verify7");
  await store.addTask("aquila", id, { title: "Call back", dueOn: todayStr() });
  assert.equal((await n.nextStepCounts("aquila", todayStr())).dueNow, c.dueNow + 1);
});

test("the Prospects tabs map filters to exactly one highlighted tab", async () => {
  const { PROSPECT_TABS, tabFor } = await import("../lib/prospecttabs.js");
  const lf = await import("../lib/leadfilters.js");
  assert.deepEqual(PROSPECT_TABS.map((t) => t.key), ["all", "none", "social", "has", "redesign", "closed", "duplicates"]);
  assert.equal(new Set(PROSPECT_TABS.map((t) => t.href)).size, 7);
  for (const tab of PROSPECT_TABS.filter((t) => t.href === "/leads" || t.href.startsWith("/leads?"))) {
    const q = Object.fromEntries(new URLSearchParams(tab.href.split("?")[1] || ""));
    assert.equal(tabFor(lf.parseFilters(q)), tab.key, tab.label);
  }
  assert.equal(tabFor(lf.parseFilters({})), "none", "the default view is No website");
  assert.equal(tabFor(lf.parseFilters({ site: "has" })), "has");
  assert.equal(tabFor(lf.parseFilters({ site: "bogus" })), "none", "junk falls back to the default view");
  assert.equal(tabFor(lf.parseFilters({ open: "closed", site: "none" })), "closed", "closed wins");
});

// ---------------- insights (business statistics) ----------------

const iso = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();
const NOW = new Date(2026, 10, 5, 12);
const TODAY = "2026-11-05";
function insightFixture() {
  return {
    leads: [
      { id: 1, source: "kestrel", category_label: "Bakery", city: "Cleveland", stage: "won", first_seen_at: iso(2026, 8, 20) },
      { id: 2, source: "kestrel", category_label: "Salon", city: "Akron", stage: "contacted", first_seen_at: iso(2026, 8, 21) },
      { id: 3, source: "kestrel", category_label: "Bakery", city: "Cleveland", stage: "new", first_seen_at: iso(2026, 9, 1) },
      { id: 4, source: "referral", category_label: "", city: "", stage: "replied", first_seen_at: iso(2026, 9, 3) },
      { id: 5, source: "kestrel", category_label: "Bakery", city: "Akron", stage: "new", first_seen_at: iso(2026, 9, 4) },
      { id: 6, source: "kestrel", category_label: "Bakery", city: "Cleveland", stage: "won", first_seen_at: iso(2026, 0, 10) },
      { id: 7, source: "kestrel", category_label: "Cafe", city: "Akron", stage: "lost", first_seen_at: iso(2026, 7, 20) },
    ],
    drafts: [
      { lead_id: 1, kind: "no_website", status: "sent", sent_at: iso(2026, 9, 1) },
      { lead_id: 2, kind: "redesign", status: "sent", sent_at: iso(2026, 9, 2) },
      { lead_id: 3, kind: "no_website", status: "draft", sent_at: null },
      { lead_id: 7, kind: null, status: "sent", sent_at: iso(2026, 8, 1) },
    ],
    emails: [{ lead_id: 1, first_at: iso(2026, 8, 30) }],
    events: [
      { lead_id: 1, to: "contacted", created_at: iso(2026, 9, 1) },
      { lead_id: 1, to: "replied", created_at: iso(2026, 9, 5) },
      { lead_id: 1, to: "meeting_booked", created_at: iso(2026, 9, 10) },
      { lead_id: 1, to: "proposal_sent", created_at: iso(2026, 9, 15) },
      { lead_id: 1, to: "won", created_at: iso(2026, 9, 25) },
      { lead_id: 7, to: "contacted", created_at: iso(2026, 8, 1) },
      { lead_id: 7, to: "replied", created_at: iso(2026, 8, 5) },
      { lead_id: 7, to: "lost", created_at: iso(2026, 8, 20) },
    ],
    invoices: [
      { status: "PAID", amount_cents: 100000, due_cents: null, currency: "USD", sent_at: iso(2026, 9, 1), paid_at: iso(2026, 9, 20), due_on: "2026-10-15", project_type: "website" },
      { status: "SENT", amount_cents: 50000, due_cents: null, currency: "USD", sent_at: iso(2026, 9, 15), paid_at: null, due_on: "2026-10-30", project_type: "website" },
      { status: "PAID", amount_cents: 30000, due_cents: null, currency: "USD", sent_at: iso(2026, 8, 1), paid_at: iso(2026, 8, 15), due_on: null, project_type: "it_support" },
      { status: "PAID", amount_cents: 99999, due_cents: null, currency: "EUR", sent_at: iso(2026, 9, 1), paid_at: iso(2026, 9, 2), due_on: null, project_type: "website" },
      { status: "CANCELLED", amount_cents: 777, due_cents: null, currency: "USD", sent_at: iso(2026, 9, 2), paid_at: null, due_on: null, project_type: "website" },
      { status: "PENDING", amount_cents: 555, due_cents: null, currency: "USD", sent_at: null, paid_at: null, due_on: null, project_type: "website" },
    ],
    projects: [
      { type: "website", status: "delivered", quoted_amount_cents: 100000, currency: "USD", created_at: iso(2026, 8, 20) },
      { type: "website", status: "proposed", quoted_amount_cents: 50000, currency: "USD", created_at: iso(2026, 9, 10) },
      { type: "app", status: "proposed", quoted_amount_cents: 0, currency: "USD", created_at: iso(2026, 9, 10) },
      { type: "website", status: "cancelled", quoted_amount_cents: 90000, currency: "USD", created_at: iso(2026, 9, 10) },
    ],
    tasks: [{ due_on: "2026-11-01" }, { due_on: "2026-11-10" }],
    meetings: [{ status: "done", starts_at: iso(2026, 9, 12) }, { status: "scheduled", starts_at: iso(2026, 10, 10) }, { status: "done", starts_at: iso(2026, 0, 12) }],
  };
}

test("insights: ranges, rates and the small sample rule", async () => {
  const ins = await import("../lib/insights.js");
  assert.equal(ins.parseRange("30"), "30");
  for (const bad of [undefined, "", "7", "all; x", null]) assert.equal(ins.parseRange(bad), "90");
  assert.equal(ins.rangeStart("all", NOW), null);
  const s30 = ins.rangeStart("30", NOW);
  assert.equal(`${s30.getFullYear()}-${s30.getMonth() + 1}-${s30.getDate()} ${s30.getHours()}`, "2026-10-7 0", "30 days including today");
  assert.deepEqual(ins.rate(3, 10), { num: 3, den: 10, pct: 30, small: true });
  assert.deepEqual(ins.rate(5, 20), { num: 5, den: 20, pct: 25, small: false });
  assert.deepEqual(ins.rate(0, 0), { num: 0, den: 0, pct: null, small: true });
  assert.equal(ins.rateText(ins.rate(3, 10)), "3 of 10, too few to judge");
  assert.equal(ins.rateText(ins.rate(5, 20)), "25% (5 of 20)");
  assert.equal(ins.rateText(ins.rate(0, 0)), "No data yet");
  assert.equal(ins.rateText(null), "No data yet");
});

test("insights: time buckets cover the period with zeros and never lose an item", async () => {
  const ins = await import("../lib/insights.js");
  const w = ins.makeBuckets(ins.rangeStart("30", NOW), NOW);
  assert.equal(w.unit, "week");
  assert.equal(w.buckets.length, 5, "weeks starting Oct 5, 12, 19, 26 and Nov 2");
  assert.equal(w.buckets[0].start.getDay(), 1, "weeks start on Monday");
  assert.equal(w.buckets[0].label, "Oct 5");
  const m = ins.makeBuckets(ins.rangeStart("365", NOW), NOW);
  assert.equal(m.unit, "month");
  assert.equal(m.buckets.length, 13);
  assert.equal(m.buckets[0].label, "Nov '25");
  assert.equal(m.buckets[2].label, "Jan '26");
  assert.equal(m.buckets[3].label, "Feb");
  const sums = ins.sumByBucket(w.buckets, [{ t: iso(2026, 9, 7) }, { t: iso(2026, 9, 8) }, { t: iso(2026, 10, 4) }, { t: iso(2026, 8, 1) }, { t: "garbage" }], (x) => x.t);
  assert.deepEqual(sums, [2, 0, 0, 0, 1], "outside the period and unreadable dates are ignored");
  const all = ins.makeBuckets(null, NOW, new Date(2026, 4, 3).getTime());
  assert.equal(all.unit, "month");
  assert.ok(all.buckets.length <= 24);
  const noData = ins.makeBuckets(null, NOW, null);
  assert.ok(noData.buckets.length >= 1, "all time with no data still draws something");
});

test("insights: the funnel counts how far each contact got, and only goes down", async () => {
  const ins = await import("../lib/insights.js");
  const rows = insightFixture();
  const ranks = ins.leadRanks(rows);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((id) => ranks.get(id)), [6, 2, 1, 3, 0, 6, 3], "lost contacts keep the progress they made");
  const f = ins.computeFunnel(rows, ins.rangeStart("90", NOW).getTime(), NOW.getTime());
  assert.deepEqual(f.map((s) => s.count), [6, 5, 4, 3, 1, 1, 1]);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].count <= f[i - 1].count, "never more at a later step");
  assert.equal(f[0].ofPrev, null);
  assert.deepEqual(f[1].ofPrev, { num: 5, den: 6, pct: 83, small: true });
  assert.deepEqual(f[6].ofFound, { num: 1, den: 6, pct: 17, small: true });
  const all = ins.computeFunnel(rows, null, NOW.getTime());
  assert.deepEqual(all.map((s) => s.count), [7, 6, 5, 4, 2, 2, 2], "all time adds the older won contact");
  assert.deepEqual(ins.computeFunnel({ leads: [] }, null, NOW.getTime()).map((s) => s.count), [0, 0, 0, 0, 0, 0, 0], "empty data");
});

test("insights: outreach results by kind of email, with the counts behind every rate", async () => {
  const ins = await import("../lib/insights.js");
  const o = ins.computeOutreach(insightFixture(), ins.rangeStart("90", NOW).getTime(), NOW.getTime(), NOW);
  assert.equal(o.totalSent, 3);
  assert.equal(o.unit, "week");
  assert.equal(o.buckets.reduce((a, b) => a + b.values[0], 0), 3, "every send lands in a week");
  const nw = o.byKind.find((k) => k.key === "no_website");
  const rd = o.byKind.find((k) => k.key === "redesign");
  assert.equal(nw.sent, 2, "an email with no recorded kind counts as no website");
  assert.deepEqual([nw.replied.num, nw.meetings.num, nw.won.num], [2, 1, 1]);
  assert.deepEqual([rd.sent, rd.replied.num, rd.won.num], [1, 0, 0]);
  assert.equal(nw.replied.small, true, "two emails is too few to judge");
  const none = ins.computeOutreach({ drafts: [], leads: [] }, null, NOW.getTime(), NOW);
  assert.equal(none.totalSent, 0);
  assert.equal(ins.rateText(none.byKind[0].replied), "No data yet");
  const month = ins.computeOutreach(insightFixture(), ins.rangeStart("30", NOW).getTime(), NOW.getTime(), NOW);
  assert.equal(month.totalSent, 0, "all three sends are older than 30 days, which starts on Oct 7");
});

test("insights: where wins come from, grouped and ranked", async () => {
  const ins = await import("../lib/insights.js");
  const rows = insightFixture();
  const s = ins.rangeStart("90", NOW).getTime();
  const cat = ins.computeWhere(rows, s, NOW.getTime(), (l) => l.category_label);
  assert.deepEqual(cat.map((c) => [c.key, c.leads, c.contacted, c.won]), [["Bakery", 3, 1, 1], ["Cafe", 1, 1, 0], ["Salon", 1, 1, 0]], "ties broken by number of leads, then name");
  assert.ok(!cat.some((c) => c.key === ""), "unknown values are left out, not grouped under nothing");
  assert.deepEqual(cat[0].winRate, { num: 1, den: 1, pct: 100, small: true }, "100 percent of one is not a result");
  const src = ins.computeWhere(rows, s, NOW.getTime(), (l) => l.source);
  assert.deepEqual(src.map((c) => [c.key, c.leads, c.contacted]), [["kestrel", 5, 3], ["referral", 1, 1]]);
  assert.equal(ins.computeWhere(rows, s, NOW.getTime(), (l) => l.city, 1).length, 1, "limit applies");
});

test("insights: days to win and activity", async () => {
  const ins = await import("../lib/insights.js");
  const sp = ins.computeSpeed(insightFixture(), ins.rangeStart("90", NOW).getTime(), NOW.getTime(), TODAY);
  assert.equal(sp.wonCount, 1);
  assert.equal(sp.medianDays, 25, "first email Sept 30 to won Oct 25");
  assert.equal(sp.overdueFollowups, 1);
  assert.equal(sp.meetingsHeld, 1, "the January meeting is outside the period");
  const empty = ins.computeSpeed({}, null, NOW.getTime(), TODAY);
  assert.deepEqual(empty, { medianDays: null, wonCount: 0, overdueFollowups: 0, meetingsHeld: 0 });
  const odd = ins.computeSpeed({ events: [{ lead_id: 1, to: "contacted", created_at: iso(2026, 9, 1) }, { lead_id: 1, to: "won", created_at: iso(2026, 9, 4) }, { lead_id: 2, to: "contacted", created_at: iso(2026, 9, 1) }, { lead_id: 2, to: "won", created_at: iso(2026, 9, 10) }, { lead_id: 3, to: "contacted", created_at: iso(2026, 9, 1) }, { lead_id: 3, to: "won", created_at: iso(2026, 9, 21) }] }, null, NOW.getTime(), TODAY);
  assert.equal(odd.medianDays, 9, "the middle of 3, 9 and 20 days");
});

test("insights: money counts only real, sent, US dollar invoices", async () => {
  const ins = await import("../lib/insights.js");
  const m = ins.computeMoney(insightFixture(), ins.rangeStart("90", NOW).getTime(), NOW.getTime(), NOW, TODAY);
  assert.equal(m.billedCents, 180000, "paid and sent invoices, not cancelled, pending or euros");
  assert.equal(m.paidCents, 130000);
  assert.deepEqual(m.revenueByType, [{ type: "website", cents: 100000 }, { type: "it_support", cents: 30000 }]);
  assert.equal(m.buckets.reduce((a, b) => a + b.values[0], 0), 180000, "every dollar billed is in a bar");
  assert.equal(m.buckets.reduce((a, b) => a + b.values[1], 0), 130000);
  assert.deepEqual([m.outstandingCents, m.outstandingCount, m.overdueCents, m.overdueCount], [50000, 1, 50000, 1]);
  assert.deepEqual([m.avgProjectCents, m.projectCount], [75000, 2], "cancelled and unpriced projects are not averaged");
  assert.deepEqual([m.openProposalCents, m.openProposalCount], [50000, 1]);
  assert.equal(m.skippedOtherCurrency, 1, "the euro invoice is reported, not mixed in");
  const none = ins.computeMoney({}, null, NOW.getTime(), NOW, TODAY);
  assert.deepEqual([none.billedCents, none.paidCents, none.avgProjectCents, none.outstandingCents], [0, 0, null, 0]);
});

test("insights: money is only computed when the viewer may see it", async () => {
  const ins = await import("../lib/insights.js");
  const rows = insightFixture();
  assert.equal(ins.computeInsights(rows, { now: NOW, todayStr: TODAY }).money, null);
  const full = ins.computeInsights(rows, { range: "30", now: NOW, includeMoney: true, todayStr: TODAY });
  assert.ok(full.money && full.funnel.length === 7 && full.range === "30");
  assert.deepEqual(Object.keys(full.where), ["category", "city", "source"]);
});

test("chart maths: round axes, compact numbers, readable labels", async () => {
  const c = await import("../lib/chartmath.js");
  assert.deepEqual(c.niceScale(0), { top: 4, step: 1 });
  assert.deepEqual(c.niceScale(7), { top: 8, step: 2 });
  assert.deepEqual(c.niceScale(10), { top: 20, step: 5 }, "2.5 per interval rounds up to 5");
  for (const v of [1, 3, 9, 37, 120, 999, 1234, 56000, 0.5]) {
    const s = c.niceScale(v);
    assert.ok(s.top >= v, `top covers ${v}`);
    assert.ok([1, 2, 5].includes(s.step / 10 ** Math.floor(Math.log10(s.step))), `step is 1, 2 or 5 times a power of ten for ${v}`);
    assert.equal(Math.round(s.top / s.step), 4, "four intervals");
  }
  assert.equal(c.compact(850), "850");
  assert.equal(c.compact(1200), "1.2k");
  assert.equal(c.compact(10000), "10k");
  assert.equal(c.compact(3400000), "3.4m");
  assert.equal(c.compact(-1500), "-1.5k");
  assert.equal(c.compactMoney(85000), "$850");
  assert.equal(c.compactMoney(123456), "$1.2k");
  assert.equal(c.labelEvery(5), 1);
  assert.equal(c.labelEvery(24, 10), 3);
  assert.equal(c.labelEvery(0), 1);
});

test("the menu has Insights right under Today", async () => {
  const nav = await import("../lib/nav.js");
  assert.deepEqual(nav.NAV_GROUPS[0].items.map((i) => i.label), ["Today", "Insights"]);
  const all = nav.NAV_GROUPS.flatMap((g) => g.items);
  assert.deepEqual(all.filter((i) => nav.isActive(i, "/insights")).map((i) => i.label), ["Insights"]);
  assert.deepEqual(all.filter((i) => nav.isActive(i, "/insights/anything")).map((i) => i.label), ["Insights"]);
  assert.ok(all.length <= 11);
});

test("drafts remember which template made them, and old drafts are filled in by lead type", async () => {
  const noSite = await seedVerifyLead("Kind Check Lead Verify8");
  const withSite = await seedAuditLead("Kind Check Site Audit8", "https://kindcheck8.example/");
  await store.saveDraft("aquila", noSite, { subject: "s", body: "b", kind: "no_website" });
  await store.saveDraft("aquila", withSite, { subject: "s", body: "b", kind: "redesign" });
  assert.equal((await store.getDraftByLead("aquila", noSite)).kind, "no_website");
  assert.equal((await store.getDraftByLead("aquila", withSite)).kind, "redesign");
  // editing the text by hand keeps the kind; regenerating can change it
  await store.saveDraft("aquila", withSite, { subject: "edited", body: "edited" });
  assert.equal((await store.getDraftByLead("aquila", withSite)).kind, "redesign", "an edit without a kind leaves it alone");
  await store.saveDraft("aquila", withSite, { subject: "again", body: "again", kind: "no_website" });
  assert.equal((await store.getDraftByLead("aquila", withSite)).kind, "no_website");
});

test("insights rows come from real data, stay inside the brand, and hide money unless asked", async () => {
  const ins = await import("../lib/insights.js");
  const lead = await seedVerifyLead("Insight Rows Lead Verify9");
  await store.saveDraft("aquila", lead, { subject: "s", body: "b", kind: "no_website" });
  await store.setStage("aquila", lead, "contacted");
  await store.setStage("aquila", lead, "replied");
  const rows = await store.insightsRows("aquila");
  assert.ok(rows.leads.some((l) => l.id === lead));
  assert.ok(rows.drafts.some((d) => d.lead_id === lead && d.kind === "no_website"));
  const mine = rows.events.filter((e) => e.lead_id === lead).map((e) => e.to);
  assert.deepEqual(mine, ["contacted", "replied"], "stage changes come back with where they went");
  assert.deepEqual(rows.invoices, [], "money tables are not read unless asked");
  assert.deepEqual(rows.projects, []);
  const withMoney = await store.insightsRows("aquila", { includeMoney: true });
  assert.ok(Array.isArray(withMoney.invoices) && Array.isArray(withMoney.projects));
  const other = await store.insightsRows("other", { includeMoney: true });
  assert.deepEqual([other.leads.length, other.drafts.length, other.events.length, other.emails.length, other.tasks.length, other.meetings.length, other.invoices.length, other.projects.length], [0, 0, 0, 0, 0, 0, 0, 0], "another brand sees none of it");
  // the real rows feed the calculations without error, and the reply is counted
  const d = ins.computeInsights(rows, { range: "all", includeMoney: true, todayStr: "2026-11-05", now: new Date() });
  assert.ok(d.funnel[0].count >= 1 && d.funnel[3].count >= 1);
  // a closed business is left out of every number
  await store.setClosed("aquila", lead, true);
  assert.ok(!(await store.insightsRows("aquila")).leads.some((l) => l.id === lead), "closed businesses are not counted");
  await store.setClosed("aquila", lead, false);
});

test("a corrupt stage log entry cannot break the statistics", async () => {
  const lead = await seedVerifyLead("Corrupt Log Lead Verify10");
  await store.addActivity("aquila", lead, { kind: "stage_change", body: "x", metadata: {} });
  const rows = await store.insightsRows("aquila");
  const ev = rows.events.filter((e) => e.lead_id === lead);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].to, "", "a missing destination becomes empty, not a crash");
  const ins = await import("../lib/insights.js");
  assert.doesNotThrow(() => ins.computeInsights(rows, { range: "all", now: new Date(), todayStr: "2026-11-05" }));
});

// ---------------- backups ----------------

async function tmpDir(prefix = "kestrel-test-") {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
const pgQ = (db) => (sql, p) => db.query(sql, p).then((r) => r.rows);

test("backup: tables are ordered parents first, found from the database, and sign in data is left out", async () => {
  const b = await import("../lib/backup.js");
  assert.deepEqual(b.orderTables(["drafts", "leads", "activities"], [{ child: "drafts", parent: "leads" }, { child: "activities", parent: "leads" }]), ["leads", "activities", "drafts"]);
  assert.deepEqual(b.orderTables(["a", "b"], [{ child: "a", parent: "a" }]), ["a", "b"], "a table pointing at itself is fine");
  assert.deepEqual(b.orderTables(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }]), ["a", "b"], "a cycle does not hang");
  assert.deepEqual(b.orderTables(["x"], [{ child: "x", parent: "gone" }]), ["x"], "links to tables not saved are ignored");
  // a table added later is picked up without changing any list
  const fake = async (sql, params) => {
    if (/information_schema\.tables/.test(sql)) return [{ table_name: "leads" }, { table_name: "brand_new_table" }, { table_name: "sessions" }, { table_name: "auth_tokens" }, { table_name: "Bad Name" }];
    if (/pg_constraint/.test(sql)) return [];
    if (/information_schema\.columns/.test(sql)) return [{ column_name: "id" }, { column_name: "note" }];
    if (/FROM "brand_new_table"/.test(sql)) return [{ id: 1, note: "hello" }];
    return [{ id: 7, note: new Date("2026-01-02T03:04:05Z") }];
  };
  const snap = await b.dumpDatabase(fake, { now: new Date("2026-11-05T12:00:00Z"), secret: "s3cret" });
  assert.deepEqual(snap.manifest.order, ["brand_new_table", "leads"]);
  assert.ok(!("sessions" in snap.tables) && !("auth_tokens" in snap.tables) && !("Bad Name" in snap.tables));
  assert.deepEqual(snap.tables.leads.rows[0], [7, "2026-01-02T03:04:05.000Z"], "dates become text");
  assert.equal(snap.manifest.secret_included, true);
  assert.equal(snap.secret, "s3cret");
  assert.equal(b.dumpDatabase.length >= 1, true);
});

test("backup: a real database round trips into a fresh one, exactly, and keeps counting ids", async () => {
  const b = await import("../lib/backup.js");
  const { query, openLocal } = await import("../lib/db.js");
  const lead = await seedVerifyLead("Backup Roundtrip Lead Verify11");
  await store.saveDraft("aquila", lead, { subject: "Subject with 'quotes' and ünïcode ✓", body: "line1\nline2", kind: "no_website" });
  await store.addActivity("aquila", lead, { kind: "note", body: "a note", metadata: { a: 1 } });
  const snap = await b.dumpDatabase((s, p) => query(s, p), { secret: null });
  assert.ok(snap.manifest.order.includes("leads") && snap.manifest.order.includes("activities") && snap.manifest.order.includes("invoices"));
  assert.ok(!snap.manifest.order.includes("sessions"));
  assert.ok(snap.manifest.order.indexOf("leads") < snap.manifest.order.indexOf("drafts"), "leads before the drafts that point at them");
  const fresh = await openLocal(undefined);
  const q2 = pgQ(fresh);
  const result = await b.restoreSnapshot(q2, snap);
  assert.equal(result.rows, Object.values(snap.manifest.counts).reduce((a, c) => a + c, 0));
  for (const [name, n] of Object.entries(snap.manifest.counts)) assert.equal((await q2(`SELECT COUNT(*)::int AS c FROM "${name}"`))[0].c, n, name);
  const original = (await query("SELECT * FROM drafts WHERE lead_id = ?", [lead]))[0];
  const copy = (await q2("SELECT * FROM drafts WHERE lead_id = $1", [lead]))[0];
  assert.deepEqual(copy, original, "a draft comes back identical, quotes and accents included");
  const ids = (await query("SELECT MAX(id)::int AS m FROM leads"))[0].m;
  assert.ok((await q2("SELECT nextval(pg_get_serial_sequence('\"leads\"', 'id'))::int AS n"))[0].n > ids, "new rows continue after the restored ones");
  // a restore never writes over data
  await assert.rejects(b.restoreSnapshot(q2, snap), (e) => e instanceof b.BackupError && /already has data/.test(e.message));
  await assert.rejects(b.restoreSnapshot((s, p) => query(s, p), snap), (e) => /already has data/.test(e.message), "and never into the live database");
  await fresh.close();
  const sparse = await openLocal(undefined);
  await sparse.exec("DROP TABLE activities CASCADE");
  await assert.rejects(b.restoreSnapshot(pgQ(sparse), snap), /no table called activities/);
  await sparse.close();
});

test("backup: files are checked, optionally encrypted, and tampering is caught", async () => {
  const b = await import("../lib/backup.js");
  const { query } = await import("../lib/db.js");
  const dir = await tmpDir();
  const q = (s, p) => query(s, p);
  const plain = await b.createBackup({ q, dir, passphrase: "", secret: "the-app-secret", now: new Date(2026, 10, 5, 9, 0, 0) });
  assert.match(plain.name, /^kestrel-backup-20261105-090000\.kbk\.gz$/);
  assert.equal(plain.encrypted, false);
  const path = await import("node:path");
  const fs = await import("node:fs");
  const ok = b.verifyBackup(path.join(dir, plain.name), "");
  assert.equal(ok.ok, true);
  assert.equal(ok.secretIncluded, true);
  assert.equal(ok.rows, plain.rows);
  assert.equal(b.readBackup(path.join(dir, plain.name), "").secret, "the-app-secret");
  // encrypted
  const enc = await b.createBackup({ q, dir, passphrase: "correct horse battery", secret: null, now: new Date(2026, 10, 5, 9, 0, 1) });
  assert.match(enc.name, /\.kbk\.enc$/);
  const raw = fs.readFileSync(path.join(dir, enc.name));
  assert.ok(!raw.toString("latin1").includes("leads"), "the table names are not readable in an encrypted file");
  assert.equal(b.verifyBackup(path.join(dir, enc.name), "correct horse battery").ok, true);
  assert.match(b.verifyBackup(path.join(dir, enc.name), "wrong passphrase").error, /Wrong passphrase/);
  assert.match(b.verifyBackup(path.join(dir, enc.name), "").error, /encrypted/);
  // flip one byte inside the ciphertext
  const hurt = Buffer.from(raw);
  hurt[hurt.length - 5] ^= 0xff;
  fs.writeFileSync(path.join(dir, "kestrel-backup-20261105-090002.kbk.enc"), hurt);
  assert.match(b.verifyBackup(path.join(dir, "kestrel-backup-20261105-090002.kbk.enc"), "correct horse battery").error, /Wrong passphrase|damaged/);
  // plain file with the data changed but a valid gzip around it
  const snap = b.readBackup(path.join(dir, plain.name), "");
  snap.tables.leads.rows.pop();
  fs.writeFileSync(path.join(dir, "kestrel-backup-20261105-090003.kbk.gz"), b.encodeSnapshot(snap, ""));
  assert.match(b.verifyBackup(path.join(dir, "kestrel-backup-20261105-090003.kbk.gz"), "").error, /checksum|incomplete/);
  // not a backup at all
  fs.writeFileSync(path.join(dir, "kestrel-backup-20261105-090004.kbk.gz"), "hello");
  assert.match(b.verifyBackup(path.join(dir, "kestrel-backup-20261105-090004.kbk.gz"), "").error, /not a Kestrel backup/);
  assert.match(b.verifyBackup(path.join(dir, "kestrel-backup-19990101-000000.kbk.gz"), "").error, /not found/);
  // a snapshot from a future format is refused rather than misread
  const future = JSON.parse(JSON.stringify(snap));
  future.manifest.format = 99;
  fs.writeFileSync(path.join(dir, "kestrel-backup-20261105-090005.kbk.gz"), b.encodeSnapshot(future, ""));
  assert.match(b.verifyBackup(path.join(dir, "kestrel-backup-20261105-090005.kbk.gz"), "").error, /this version can read/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("backup: the newest are kept, strangers are never touched, and staleness is reported", async () => {
  const b = await import("../lib/backup.js");
  const { query } = await import("../lib/db.js");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dir = await tmpDir();
  for (let i = 0; i < 5; i++) await b.createBackup({ q: (s, p) => query(s, p), dir, passphrase: "", keep: 3, now: new Date(2026, 10, 1 + i, 3, 0, 0) });
  fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
  fs.writeFileSync(path.join(dir, "kestrel-backup-20261101-030000.kbk.gz.tmp"), "half written");
  fs.writeFileSync(path.join(dir, "kestrel-backup-bad.kbk.gz"), "x");
  const names = b.listBackups(dir).map((x) => x.name);
  assert.deepEqual(names, ["kestrel-backup-20261105-030000.kbk.gz", "kestrel-backup-20261104-030000.kbk.gz", "kestrel-backup-20261103-030000.kbk.gz"], "newest three, newest first");
  assert.deepEqual(b.pruneBackups(dir, 0).length, 2, "keeping zero still keeps one");
  assert.equal(b.listBackups(dir).length, 1);
  for (const stranger of ["notes.txt", "kestrel-backup-20261101-030000.kbk.gz.tmp", "kestrel-backup-bad.kbk.gz"]) assert.ok(fs.existsSync(path.join(dir, stranger)), stranger + " is untouched");
  const st = b.backupStatus(dir, new Date(Date.now()));
  assert.equal(st.count, 1);
  assert.equal(st.stale, false, "age comes from the file time, not from the date in its name");
  fs.utimesSync(path.join(dir, names[0]), new Date(), new Date());
  assert.equal(b.backupStatus(dir).stale, false, "just made");
  const old = new Date(Date.now() - 9 * 86400000);
  fs.utimesSync(path.join(dir, names[0]), old, old);
  assert.equal(b.backupStatus(dir).stale, true, "nine days old");
  assert.deepEqual(b.backupStatus(path.join(dir, "missing")), { count: 0, newest: null, ageDays: null, stale: true });
  // only an absolute folder is accepted from the environment
  assert.equal(b.backupDir({ BACKUP_DIR: "relative/folder" }).includes("relative"), false);
  assert.equal(b.backupDir({ BACKUP_DIR: path.resolve(dir, "elsewhere") }), path.resolve(dir, "elsewhere"));
  assert.ok(b.BACKUP_NAME.test("kestrel-backup-20261105-030000.kbk.enc"));
  for (const bad of ["../kestrel-backup-20261105-030000.kbk.gz", "kestrel-backup-20261105-030000.kbk.gz/../x", "kestrel-backup-2026.kbk.gz", "x.kbk.gz", "kestrel-backup-20261105-030000.kbk.gz.tmp", "kestrel-backup-20261105-030000.kbk.zip"]) assert.equal(b.BACKUP_NAME.test(bad), false, bad);
  const failing = b.createBackup({ q: (s, p) => query(s, p), dir: path.join(dir, "notes.txt", "cannot"), passphrase: "", now: new Date() });
  await assert.rejects(failing, (e) => e instanceof b.BackupError && /Could not save the backup/.test(e.message));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- contact export and delete ----------------

test("a contact export holds everything about one contact and nothing about anyone else", async () => {
  const privacy = await import("../lib/privacy.js");
  const lead = await seedVerifyLead("Export Contact Verify12");
  const other = await seedVerifyLead("Someone Else Verify12");
  await store.updateLeadContact("aquila", lead, { contact_email: "owner@exportme.example", notes: "likes mornings", status: "contacted" });
  await store.saveDraft("aquila", lead, { subject: "Hello", body: "Body text", kind: "no_website" });
  await store.addActivity("aquila", lead, { kind: "note", body: "Called, left a message" });
  await store.addTask("aquila", lead, { title: "Call back", dueOn: "2026-12-01" });
  await store.createMeeting("aquila", { leadId: lead, title: "Intro call", location: "phone", startsAt: new Date(2026, 11, 2, 15).toISOString() });
  await store.addSuppression("aquila", "owner@exportme.example", "unsubscribe");
  await store.addActivity("aquila", other, { kind: "note", body: "THIS BELONGS TO SOMEONE ELSE" });
  const x = await privacy.contactExport("aquila", lead);
  assert.equal(x.contact.name, "Export Contact Verify12");
  assert.equal(x.contact.contact_email, "owner@exportme.example");
  assert.equal(x.contact.notes, "likes mornings");
  assert.ok(!("mockup_token" in x.contact), "a private link is not part of the person's data");
  assert.equal(x.drafts[0].body, "Body text");
  assert.ok(x.activities.some((a) => a.body === "Called, left a message"));
  assert.equal(x.tasks[0].title, "Call back");
  assert.equal(x.meetings[0].title, "Intro call");
  assert.equal(x.do_not_contact_entry.email, "owner@exportme.example");
  assert.equal(x.client, null);
  assert.ok(!JSON.stringify(x).includes("BELONGS TO SOMEONE ELSE"), "nothing about anyone else");
  assert.equal(await privacy.contactExport("other", lead), null, "another brand cannot export it");
  assert.equal(await privacy.contactExport("aquila", 99999999), null);
  assert.doesNotThrow(() => JSON.stringify(x), "it can be saved as a file");
  const asClient = await store.convertToClient("aquila", lead);
  const proj = await store.createProject("aquila", asClient.id, { name: "Site", type: "website", status: "proposed", quotedCents: 123400 });
  const y = await privacy.contactExport("aquila", lead);
  assert.equal(y.client.id, asClient.id);
  assert.equal(y.projects[0].quoted_amount_cents, 123400);
  assert.ok(proj);
});

test("deleting a contact removes it, keeps only a do not contact entry, and stops a rescan bringing it back", async () => {
  const privacy = await import("../lib/privacy.js");
  const { query } = await import("../lib/db.js");
  const place = { place_id: "osm:node/DeleteMe13", name: "Delete Me Cafe Verify13", category: "cafe", category_label: "Cafe", address: "", city: "Veriton", region: "VT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" };
  const made = await store.upsertPlace("aquila", place, "shops in Veriton, VT");
  const lead = made.id;
  const keep = await seedVerifyLead("Keep Me Verify13");
  await store.updateLeadContact("aquila", lead, { contact_email: "gone@deleteme.example", notes: "private note", status: "new" });
  await store.saveDraft("aquila", lead, { subject: "s", body: "b" });
  await store.addActivity("aquila", lead, { kind: "note", body: "x" });
  await store.addTask("aquila", lead, { title: "t", dueOn: "2026-12-01" });
  await store.createMeeting("aquila", { leadId: lead, title: "m", location: "phone", startsAt: new Date().toISOString() });
  const sum = await privacy.deleteSummary("aquila", lead);
  assert.deepEqual(sum, { drafts: 1, activities: (await query("SELECT COUNT(*)::int AS n FROM activities WHERE lead_id = ?", [lead]))[0].n, tasks: 1, meetings: 1, deals: 0 });
  assert.equal((await privacy.deleteContact({ brandId: "other", leadId: lead })).deleted, false, "another brand cannot delete it");
  assert.ok(await store.getLead("aquila", lead));
  const r = await privacy.deleteContact({ brandId: "aquila", leadId: lead, userId: null, ip: "127.0.0.1" });
  assert.deepEqual(r, { deleted: true });
  assert.equal(await store.getLead("aquila", lead), null);
  for (const t of ["drafts", "activities", "tasks", "meetings"]) assert.equal((await query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE lead_id = ?`, [lead]))[0].n, 0, t + " are gone with the contact");
  assert.ok(await store.getLead("aquila", keep), "other contacts are untouched");
  assert.equal(await store.isSuppressed("aquila", "gone@deleteme.example"), true, "the address stays on the do not contact list");
  const again = await store.upsertPlace("aquila", place, "shops in Veriton, VT");
  assert.deepEqual(again, { created: false, id: null, skipped: true }, "a rescan does not bring it back");
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM leads WHERE place_id = 'osm:node/DeleteMe13'"))[0].n, 0);
  const audit = (await query("SELECT detail FROM audit_log WHERE event = 'contact_deleted' ORDER BY id DESC LIMIT 1"))[0];
  assert.equal(audit.detail, `contact ${lead}`, "the log says who and when, never the person's details");
  assert.deepEqual(await privacy.deleteContact({ brandId: "aquila", leadId: lead }), { deleted: false, reason: "That contact was not found." });
  // the same place in another brand is a different record and is not blocked
  const otherBrand = await store.upsertPlace("other", place, "shops in Veriton, VT");
  assert.equal(otherBrand.created, true);
});

test("a client with projects cannot be deleted; a client with none is deleted with the contact", async () => {
  const privacy = await import("../lib/privacy.js");
  const { query } = await import("../lib/db.js");
  const withWork = await seedVerifyLead("Client With Work Verify14");
  const c1 = await store.convertToClient("aquila", withWork);
  await store.createProject("aquila", c1.id, { name: "Paid job", type: "website", status: "in_progress", quotedCents: 50000 });
  const blocked = await privacy.deleteContact({ brandId: "aquila", leadId: withWork });
  assert.equal(blocked.deleted, false);
  assert.match(blocked.reason, /financial records/);
  assert.ok(await store.getLead("aquila", withWork), "nothing was deleted");
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM clients WHERE lead_id = ?", [withWork]))[0].n, 1);
  assert.match(await privacy.deleteBlocker("aquila", withWork), /financial records/);
  const noWork = await seedVerifyLead("Client Without Work Verify14");
  await store.convertToClient("aquila", noWork);
  assert.equal(await privacy.deleteBlocker("aquila", noWork), null);
  assert.deepEqual(await privacy.deleteContact({ brandId: "aquila", leadId: noWork }), { deleted: true });
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM clients WHERE name = 'Client Without Work Verify14'"))[0].n, 0, "the empty client record goes too");
});

test("the scheduler endpoints refuse anyone without the secret", async () => {
  const { cronAuthorized } = await import("../lib/cronauth.js");
  const req = (auth) => ({ headers: { get: (k) => (k.toLowerCase() === "authorization" ? auth : null) } });
  const good = "a-long-enough-secret-value";
  assert.equal(cronAuthorized(req("Bearer " + good), { CRON_SECRET: good }), true);
  assert.equal(cronAuthorized(req("Bearer " + good + "x"), { CRON_SECRET: good }), false);
  assert.equal(cronAuthorized(req("Bearer nope"), { CRON_SECRET: good }), false);
  assert.equal(cronAuthorized(req(null), { CRON_SECRET: good }), false, "no header");
  assert.equal(cronAuthorized(req(""), { CRON_SECRET: good }), false);
  assert.equal(cronAuthorized(req("Bearer short"), { CRON_SECRET: "short" }), null, "a short secret switches the endpoint off");
  assert.equal(cronAuthorized(req("Bearer x"), {}), null, "no secret: switched off, never open");
});

test("next step: a backup reminder comes last, only when asked, and only with data to save", async () => {
  const n = await import("../lib/nextstep.js");
  const base = { dueNow: 0, review: 0, approved: 0, lookups: 0, unscored: 0, backupDue: false };
  assert.deepEqual(n.pickSteps(base), []);
  const due = n.pickSteps({ ...base, backupDue: true });
  assert.equal(due[0].key, "backup");
  assert.equal(due[0].href, "/settings/backups");
  assert.match(due[0].text, /has not been backed up in the last 7 days/);
  assert.deepEqual(n.pickSteps({ ...base, review: 2, unscored: 1, backupDue: true }).map((s) => s.key), ["review", "score", "backup"], "backups never push aside the people waiting on you");
  assert.equal(n.pickNext({ ...base, backupDue: true }, "/settings/backups").key, "scan", "not shown on the page that does it");
  const { todayStr } = await import("../lib/crm.js");
  assert.equal((await n.nextStepCounts("aquila", todayStr(), { checkBackup: true })).backupDue, true, "there is data and no backup in the test data folder");
  assert.equal((await n.nextStepCounts("aquila", todayStr(), { checkBackup: false })).backupDue, false);
  assert.equal((await n.nextStepCounts("brand-with-no-data", todayStr(), { checkBackup: true })).backupDue, false, "an empty brand has nothing to back up");
});

// ---------------- deals and forecast ----------------

test("deal input is checked: money, chance, date, type, and sizes", async () => {
  const d = await import("../lib/deals.js");
  const ok = d.validateDealInput({ title: "  Site for Joe ", amount: "2,500.50", probability: "", expectedCloseOn: "2026-12-01", type: "app" });
  assert.deepEqual(ok, { ok: true, value: { title: "Site for Joe", amountCents: 250050, probability: 20, expectedCloseOn: "2026-12-01", type: "app" } });
  assert.equal(d.validateDealInput({ title: "x", probability: "" }, { stage: "proposal" }).value.probability, 50, "blank chance takes the stage's usual figure");
  assert.equal(d.validateDealInput({ title: "x", probability: "" }, { stage: "negotiation" }).value.probability, 75);
  assert.equal(d.validateDealInput({ title: "x", probability: "35" }).value.probability, 35, "an explicit chance wins");
  assert.equal(d.validateDealInput({ title: "x", probability: "0" }).value.probability, 0);
  assert.equal(d.validateDealInput({ title: "x", probability: "100" }).value.probability, 100);
  const bare = d.validateDealInput({ title: "x" });
  assert.deepEqual([bare.value.amountCents, bare.value.expectedCloseOn, bare.value.type], [null, null, "website"], "amount and date are optional");
  assert.equal(d.validateDealInput({ title: "x", type: "<script>" }).value.type, "website", "an unknown type falls back, never passes through");
  const bad = (input) => d.validateDealInput(input);
  assert.match(bad({ title: "" }).errors[0], /name/);
  assert.match(bad({ title: "   " }).errors[0], /name/);
  assert.match(bad({ title: "x".repeat(121) }).errors[0], /too long/);
  assert.equal(bad({ title: "x".repeat(120) }).ok, true);
  for (const amount of ["abc", "$-5", "1e5", "12.345", "-1", "1,2,3x"]) assert.match(bad({ title: "x", amount }).errors[0], /plain number/, amount);
  assert.match(bad({ title: "x", amount: "20,000,001" }).errors[0], /too large/);
  assert.equal(bad({ title: "x", amount: "20000000" }).ok, true, "exactly the limit is allowed");
  assert.equal(bad({ title: "x", amount: "$99" }).value.amountCents, 9900);
  for (const probability of ["101", "-1", "5.5", "abc", "1000", "1e1"]) assert.match(bad({ title: "x", probability }).errors[0], /0 to 100/, probability);
  for (const expectedCloseOn of ["2026-13-45", "tomorrow", "12/01/2026", "2026-1-1x"]) assert.match(bad({ title: "x", expectedCloseOn }).errors[0], /real date/, expectedCloseOn);
  assert.equal(bad({ title: "", amount: "abc", probability: "999", expectedCloseOn: "nope" }).errors.length, 4, "every problem is reported at once");
  assert.equal(d.weightedCents({ amount_cents: 1000000, probability: 50 }), 500000);
  assert.equal(d.weightedCents({ amount_cents: null, probability: 90 }), 0);
  assert.equal(d.weightedCents({ amount_cents: 10001, probability: 33 }), 3300, "rounded to a whole cent");
  assert.equal(d.weightedCents({ amount_cents: 500, probability: null }), 0);
  assert.deepEqual(["discovery", "proposal", "negotiation"].map(d.nextDealStage), ["proposal", "negotiation", null]);
  assert.deepEqual(["discovery", "proposal", "negotiation", "won", "lost", "x"].map(d.dealStageLabel), ["Discovery", "Proposal", "Negotiation", "Won", "Lost", "x"]);
  assert.equal(d.isOpenStage("won"), false);
  assert.equal(d.lostReasonLabel("price"), "Price");
  assert.equal(d.lostReasonLabel("nope"), "");
});

function dealFixture() {
  const iso2 = (s) => `${s}T12:00:00.000Z`;
  return [
    { id: 1, stage: "discovery", amount_cents: 1000000, probability: 20, expected_close_on: "2026-11-20" },
    { id: 2, stage: "proposal", amount_cents: 2000000, probability: 50, expected_close_on: "2026-12-15" },
    { id: 3, stage: "negotiation", amount_cents: 500000, probability: 75, expected_close_on: "2026-10-30" },
    { id: 4, stage: "discovery", amount_cents: 300000, probability: 20, expected_close_on: null },
    { id: 5, stage: "proposal", amount_cents: null, probability: 50, expected_close_on: "2026-11-05" },
    { id: 6, stage: "negotiation", amount_cents: 400000, probability: 75, expected_close_on: "2027-06-01" },
    { id: 7, stage: "won", amount_cents: 800000, probability: 100, created_at: iso2("2026-09-01"), closed_at: iso2("2026-10-11") },
    { id: 8, stage: "won", amount_cents: 400000, probability: 100, created_at: iso2("2026-10-01"), closed_at: iso2("2026-10-21") },
    { id: 9, stage: "lost", amount_cents: 700000, probability: 0, created_at: iso2("2026-08-20"), closed_at: iso2("2026-09-10"), lost_reason: "price" },
    { id: 10, stage: "lost", amount_cents: 100000, probability: 0, created_at: iso2("2026-01-01"), closed_at: iso2("2026-01-10"), lost_reason: "timing" },
  ];
}

test("forecast: open value, weighted value, timeline buckets, and what cannot be placed", async () => {
  const d = await import("../lib/deals.js");
  const f = d.computeForecast(dealFixture(), { today: "2026-11-05" });
  assert.deepEqual(f.open, { count: 6, cents: 4200000, weightedCents: 1935000, overdueCount: 1, noDateCount: 1, noAmountCount: 1 });
  assert.deepEqual(f.buckets.map((b) => b.label), ["Overdue", "Nov '26", "Dec", "Jan '27", "Feb", "Mar", "Apr", "Later"]);
  assert.deepEqual(f.buckets.map((b) => b.values), [[500000, 375000], [1000000, 200000], [2000000, 1000000], [0, 0], [0, 0], [0, 0], [0, 0], [400000, 300000]]);
  const placed = f.buckets.reduce((a, b) => a + b.values[0], 0);
  assert.equal(placed, f.open.cents - 300000, "every dollar is on the timeline except the one deal with no date");
  assert.equal(f.buckets.reduce((a, b) => a + b.values[1], 0), f.open.weightedCents - 60000, "the same for the weighted figure");
  assert.deepEqual(f.won, { count: 2, cents: 1200000 });
  assert.equal(f.lost.count, 1, "the January loss is outside the 90 days");
  assert.deepEqual(f.winRate, { num: 2, den: 3, pct: 67, small: true });
  assert.equal(f.avgWonCents, 600000);
  assert.equal(f.avgDaysToClose, 30);
  assert.deepEqual(f.lostReasons, [{ key: "price", label: "Price", count: 1 }]);
  const wide = d.computeForecast(dealFixture(), { today: "2026-11-05", closedWithinDays: 400 });
  assert.equal(wide.lost.count, 2, "a longer window includes the older loss");
  const empty = d.computeForecast([], { today: "2026-11-05" });
  assert.deepEqual(empty.open, { count: 0, cents: 0, weightedCents: 0, overdueCount: 0, noDateCount: 0, noAmountCount: 0 });
  assert.equal(empty.buckets.length, 6, "no overdue or later bucket when there is nothing there");
  assert.equal(empty.avgWonCents, null);
  assert.equal(empty.avgDaysToClose, null);
  assert.deepEqual(empty.winRate, { num: 0, den: 0, pct: null, small: true });
  const roll = d.computeForecast([{ id: 1, stage: "discovery", amount_cents: 100, probability: 10, expected_close_on: "2027-01-31" }], { today: "2026-12-20", months: 3 });
  assert.deepEqual(roll.buckets.map((b) => b.label), ["Dec '26", "Jan '27", "Feb"], "the year rolls over");
  assert.deepEqual(roll.buckets[1].values, [100, 10]);
  assert.equal(d.computeForecast([{ id: 1, stage: "discovery", amount_cents: 100, probability: 10, expected_close_on: "2026-11-05" }], { today: "2026-11-05" }).open.overdueCount, 0, "due today is not overdue");
});

test("a deal moves through stages, nudging the contact, and a bad move is refused", async () => {
  const lead = await seedVerifyLead("Deal Move Lead Verify15");
  const id = await store.createDeal("aquila", lead, { title: "Website", amountCents: 100000, expectedCloseOn: "2026-12-01", type: "website" });
  let deal = await store.getDeal("aquila", id);
  assert.deepEqual([deal.stage, deal.probability, deal.amount_cents, deal.lead_name], ["discovery", 20, 100000, "Deal Move Lead Verify15"]);
  assert.ok((await store.listActivities("aquila", lead)).some((a) => /Deal added: Website/.test(a.body)), "the timeline records it");
  assert.equal((await store.moveDeal("aquila", id, "discovery")).changed, false, "same stage does nothing");
  assert.equal((await store.moveDeal("aquila", id, "proposal")).changed, true);
  deal = await store.getDeal("aquila", id);
  assert.deepEqual([deal.stage, deal.probability, deal.lead_stage], ["proposal", 50, "proposal_sent"], "a proposal moves the contact to Proposal sent");
  await store.moveDeal("aquila", id, "negotiation");
  assert.equal((await store.getDeal("aquila", id)).probability, 75);
  await assert.rejects(store.moveDeal("aquila", id, "won"), /open stage/);
  await assert.rejects(store.moveDeal("aquila", id, "bogus"), /open stage/);
  await assert.rejects(store.moveDeal("other", id, "proposal"), /Only an open deal/, "another brand cannot move it");
  // the contact is never pulled backwards or moved when already further on
  const further = await seedVerifyLead("Deal Further Lead Verify15");
  await store.setStage("aquila", further, "won");
  const d2 = await store.createDeal("aquila", further, { title: "More work" });
  await store.moveDeal("aquila", d2, "proposal");
  assert.equal((await store.getLead("aquila", further)).stage, "won");
  // the contact must belong to the brand
  await assert.rejects(store.createDeal("other", lead, { title: "Stolen" }), /Contact not found/);
  await assert.rejects(store.createDeal("aquila", lead, { title: "x", stage: "won" }), /open stage/);
  // editing
  assert.equal(await store.updateDeal("aquila", id, { title: "Website v2", amountCents: 250000, probability: 60, expectedCloseOn: null, type: "app" }), true);
  deal = await store.getDeal("aquila", id);
  assert.deepEqual([deal.title, deal.amount_cents, deal.probability, deal.expected_close_on, deal.type], ["Website v2", 250000, 60, null, "app"]);
  assert.equal(await store.updateDeal("other", id, { title: "Hacked", amountCents: 1, probability: 1, expectedCloseOn: null, type: "app" }), false);
  assert.equal((await store.getDeal("aquila", id)).title, "Website v2");
});


test("winning a deal makes the client and the project once, and marks the contact won", async () => {
  const { query } = await import("../lib/db.js");
  const lead = await seedVerifyLead("Deal Win Lead Verify16");
  const id = await store.createDeal("aquila", lead, { title: "Big Site", amountCents: 480000, type: "app" });
  await assert.rejects(store.winDeal("other", id), /Deal not found/, "another brand cannot win it");
  assert.equal((await store.getDeal("aquila", id)).stage, "discovery");
  const r = await store.winDeal("aquila", id, { userId: null });
  assert.equal(r.won, true);
  const deal = await store.getDeal("aquila", id);
  assert.deepEqual([deal.stage, deal.probability, deal.project_id === r.projectId, !!deal.closed_at, deal.lead_stage], ["won", 100, true, true, "won"]);
  const project = (await query("SELECT name, type, status, quoted_amount_cents, client_id FROM projects WHERE id = ?", [r.projectId]))[0];
  assert.deepEqual([project.name, project.type, project.status, project.quoted_amount_cents, project.client_id], ["Big Site", "app", "in_progress", 480000, r.clientId], "the project carries the deal's name, type and amount");
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM clients WHERE lead_id = ?", [lead]))[0].n, 1);
  assert.ok((await store.listActivities("aquila", lead)).some((a) => /Deal won: Big Site/.test(a.body)));
  assert.deepEqual(await store.winDeal("aquila", id), { won: false, reason: "This deal is already won." }, "winning twice changes nothing");
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM projects WHERE client_id = ?", [r.clientId]))[0].n, 1, "no second project");
  assert.equal(await store.reopenDeal("aquila", id), false, "a won deal cannot be reopened");
  assert.deepEqual(await store.loseDeal("aquila", id, "price"), { lost: false });
  // a contact that is already a client gets the new project on the same client
  const second = await store.createDeal("aquila", lead, { title: "Maintenance", amountCents: 60000, type: "it_support" });
  const r2 = await store.winDeal("aquila", second);
  assert.equal(r2.clientId, r.clientId, "the same client");
  assert.notEqual(r2.projectId, r.projectId);
  // privacy: a won deal means financial records, so the contact cannot be deleted
  const privacy = await import("../lib/privacy.js");
  const exp = await privacy.contactExport("aquila", lead);
  assert.deepEqual(exp.deals.map((x) => x.title).sort(), ["Big Site", "Maintenance"], "the export includes deals");
  assert.equal((await privacy.deleteSummary("aquila", lead)).deals, 2);
  assert.equal((await privacy.deleteContact({ brandId: "aquila", leadId: lead })).deleted, false);
});

test("losing a deal needs a reason, moves the contact only when nothing else is open, and can be reopened", async () => {
  const lead = await seedVerifyLead("Deal Lose Lead Verify17");
  const a = await store.createDeal("aquila", lead, { title: "A" });
  const b = await store.createDeal("aquila", lead, { title: "B" });
  await assert.rejects(store.loseDeal("aquila", a, ""), /reason/);
  await assert.rejects(store.loseDeal("aquila", a, "because"), /reason/);
  assert.equal((await store.getDeal("aquila", a)).stage, "discovery", "a refused loss changes nothing");
  assert.deepEqual(await store.loseDeal("aquila", a, "price"), { lost: true });
  let deal = await store.getDeal("aquila", a);
  assert.deepEqual([deal.stage, deal.probability, deal.lost_reason, !!deal.closed_at], ["lost", 0, "price", true]);
  assert.equal((await store.getLead("aquila", lead)).stage, "new", "another deal is still open, so the contact is not lost");
  await store.loseDeal("aquila", b, "timing");
  assert.equal((await store.getLead("aquila", lead)).stage, "lost", "no open deals left");
  assert.deepEqual(await store.loseDeal("aquila", b, "timing"), { lost: false }, "losing twice does nothing");
  assert.equal(await store.reopenDeal("other", a), false, "another brand cannot reopen it");
  assert.equal(await store.reopenDeal("aquila", a), true);
  deal = await store.getDeal("aquila", a);
  assert.deepEqual([deal.stage, deal.probability, deal.lost_reason, deal.closed_at], ["discovery", 20, null, null]);
  assert.equal(await store.updateDeal("aquila", b, { title: "B2", amountCents: null, probability: 10, expectedCloseOn: null, type: "website" }), false, "a lost deal cannot be edited");
});

test("deal lists, the overdue count, and the forecast rows stay inside the brand", async () => {
  const lead = await seedVerifyLead("Deal List Lead Verify18");
  const late = await store.createDeal("aquila", lead, { title: "Late One", amountCents: 1000, expectedCloseOn: "2020-01-01" });
  const future = await store.createDeal("aquila", lead, { title: "Future One", amountCents: 2000, expectedCloseOn: "2099-01-01" });
  const nodate = await store.createDeal("aquila", lead, { title: "No Date One" });
  const open = (await store.listDeals("aquila", { status: "open" })).map((d) => d.id);
  for (const id of [late, future, nodate]) assert.ok(open.includes(id));
  assert.ok(open.indexOf(late) < open.indexOf(future) && open.indexOf(future) < open.indexOf(nodate), "soonest expected close first, no date last");
  const mine = await store.listDeals("aquila", { leadId: lead });
  assert.equal(mine.length, 3);
  assert.ok(mine.every((d) => d.lead_name === "Deal List Lead Verify18"));
  assert.deepEqual(await store.listDeals("other"), [], "another brand sees none");
  assert.deepEqual(await store.dealsForForecast("other"), []);
  assert.ok((await store.countOverdueDeals("aquila", "2026-11-05")) >= 1);
  assert.equal(await store.countOverdueDeals("other", "2026-11-05"), 0);
  await store.loseDeal("aquila", late, "other");
  assert.ok(!(await store.listDeals("aquila", { status: "open" })).some((d) => d.id === late), "closed deals leave the open list");
  assert.ok((await store.listDeals("aquila", { status: "lost" })).some((d) => d.id === late));
  const rows = await store.dealsForForecast("aquila");
  assert.ok(rows.length >= 3 && "stage" in rows[0] && "amount_cents" in rows[0] && "closed_at" in rows[0]);
  const d = await import("../lib/deals.js");
  assert.doesNotThrow(() => d.computeForecast(rows, { today: "2026-11-05" }), "real rows feed the forecast");
  // a database rule backs the code: nothing outside the allowed values can be stored
  const { query } = await import("../lib/db.js");
  await assert.rejects(query("UPDATE deals SET stage = 'maybe' WHERE id = ?", [future]));
  await assert.rejects(query("UPDATE deals SET probability = 101 WHERE id = ?", [future]));
  await assert.rejects(query("UPDATE deals SET amount_cents = -5 WHERE id = ?", [future]));
  await assert.rejects(query("UPDATE deals SET lost_reason = 'whim' WHERE id = ?", [future]));
});

test("the menu has Deals between Pipeline and Calendar, and overdue deals are a next step", async () => {
  const nav = await import("../lib/nav.js");
  assert.deepEqual(nav.NAV_GROUPS.find((g) => g.key === "follow").items.map((i) => i.label), ["Pipeline", "Deals", "Calendar"]);
  const all = nav.NAV_GROUPS.flatMap((g) => g.items);
  assert.deepEqual(all.filter((i) => nav.isActive(i, "/deals/12")).map((i) => i.label), ["Deals"]);
  const n = await import("../lib/nextstep.js");
  const base = { dueNow: 0, review: 0, approved: 0, lookups: 0, unscored: 0, dealsOverdue: 0, backupDue: false };
  const steps = n.pickSteps({ ...base, dueNow: 1, dealsOverdue: 2, review: 3 });
  assert.deepEqual(steps.map((s) => s.key), ["followups", "deals", "review"], "money waiting on a decision comes right after people waiting on you");
  assert.equal(n.pickSteps({ ...base, dealsOverdue: 1 })[0].text, "1 deal is past the expected close date");
  assert.equal(n.pickSteps({ ...base, dealsOverdue: 3 })[0].text, "3 deals are past the expected close date");
  assert.equal(n.pickNext({ ...base, dealsOverdue: 3 }, "/deals").key, "scan", "not shown on the page that fixes it");
});

// ---------------- duplicates and merging ----------------

const dl = (id, o = {}) => ({ id, name: "", city: "", phone: "", contact_email: "", website: "", lat: null, lon: null, stage: "new", has_client: false, ...o });

test("duplicates: only the same business is flagged, never a different place or a chain", async () => {
  const d = await import("../lib/dupes.js");
  const leads = [
    dl(1, { name: "Citizen Pie", city: "Cleveland", phone: "(216) 555-0100", website: "https://citizenpie.com/", lat: 41.48, lon: -81.7 }),
    dl(2, { name: "Citizen Pie", city: "Cleveland", lat: 41.4801, lon: -81.7001 }),
    dl(3, { name: "Citizen Pie", city: "Akron", lat: 41.08, lon: -81.52 }),
    dl(4, { name: "Starbucks", city: "Cleveland", lat: 41.5, lon: -81.69 }),
    dl(5, { name: "Starbucks", city: "Cleveland", lat: 41.51, lon: -81.68 }),
    dl(6, { name: "Joe's Barber Shop", phone: "330-555-0111" }),
    dl(7, { name: "Joe's Barber", phone: "(330) 555-0111" }),
    dl(8, { name: "Rosa Nails", contact_email: "rosa@nails.example" }),
    dl(9, { name: "Rosa Nails Studio", contact_email: "ROSA@nails.example" }),
    dl(10, { name: "Blue Door Cafe", website: "https://www.bluedoor.example/menu" }),
    dl(11, { name: "The Blue Door", website: "http://bluedoor.example" }),
    dl(12, { name: "Great Clips Akron", city: "Akron", phone: "800-555-0000" }),
    dl(13, { name: "Great Clips Canton", city: "Canton", phone: "800-555-0000" }),
    dl(14, { name: "Cafe X", website: "https://facebook.com/cafex" }),
    dl(15, { name: "Cafe X Two", website: "https://facebook.com/cafex" }),
  ];
  const groups = d.findDuplicateGroups(leads);
  assert.deepEqual(groups.map((g) => g.ids), [[1, 2], [6, 7], [8, 9], [10, 11]]);
  assert.deepEqual(groups.map((g) => g.reasons), [["Same name in the same place"], ["Same phone number"], ["Same email address"], ["Same website"]]);
  const by = (a, b) => d.duplicateReason(leads.find((l) => l.id === a), leads.find((l) => l.id === b));
  assert.equal(by(1, 3), null, "same name, different city and far apart");
  assert.equal(by(4, 5), null, "two shops of a chain a kilometre apart");
  assert.equal(by(12, 13), null, "a shared corporate phone line, different cities");
  assert.equal(by(14, 15), null, "a shared social page says nothing about the business");
  assert.equal(by(1, 1), null, "a contact is not its own duplicate");
  assert.equal(by(1, 999), null);
  assert.equal(d.duplicateReason(null, leads[0]), null);
  // a shared phone with an unrelated name is a shared line, not a duplicate
  assert.equal(d.duplicateReason(dl(1, { name: "Alpha Plumbing", phone: "216-555-0100" }), dl(2, { name: "Zed Bakery", phone: "216-555-0100" })), null);
  assert.equal(d.duplicateReason(dl(1, { name: "Alpha Plumbing", contact_email: "a@x.example" }), dl(2, { name: "Zed Bakery", contact_email: "a@x.example" })), null, "same for a shared email");
  // an entry with no coordinates can still match one that has them
  assert.equal(d.duplicateReason(dl(1, { name: "Pie Shop", lat: 41.5, lon: -81.5 }), dl(2, { name: "Pie Shop" })), "Same name in the same place");
  // dismissed pairs disappear, and a dismissal does not hide other pairs
  assert.deepEqual(d.findDuplicateGroups(leads, new Set(["1:2"])).map((g) => g.ids), [[6, 7], [8, 9], [10, 11]]);
  assert.equal(d.pairKey(5, 2), "2:5");
});

test("duplicates: a chain of matches becomes one group, and survivors are chosen sensibly", async () => {
  const d = await import("../lib/dupes.js");
  const chain = [
    dl(20, { name: "Mia Cafe", phone: "330-555-0222" }),
    dl(21, { name: "Mia Cafe Bistro", phone: "(330) 555-0222", contact_email: "mia@x.example" }),
    dl(22, { name: "Mia Cafe Bistro", contact_email: "mia@x.example" }),
    dl(30, { name: "Unrelated Garage" }),
  ];
  const g = d.findDuplicateGroups(chain);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].ids, [20, 21, 22], "A matches B and B matches C, so all three are one business");
  assert.deepEqual(g[0].reasons, ["Same phone number", "Same email address"]);
  assert.equal(d.pickSurvivor([dl(5), dl(3, { stage: "replied" }), dl(9, { has_client: true })]).id, 9, "a client is always kept");
  assert.equal(d.pickSurvivor([dl(5), dl(3, { stage: "replied" }), dl(9)]).id, 3, "then the furthest along");
  assert.equal(d.pickSurvivor([dl(5), dl(3), dl(9)]).id, 3, "then the oldest");
  assert.equal(d.pickSurvivor([dl(5, { contact_email: "a@x.example" }), dl(3)]).id, 5, "an email address breaks a tie");
  assert.equal(d.stageRank("won"), 5);
  assert.equal(d.stageRank("lost"), 0);
  assert.equal(d.stageRank("nonsense"), 0);
  // a huge identical bucket is a chain or a data glitch, so it is not offered
  const crowd = Array.from({ length: 61 }, (_, i) => dl(100 + i, { name: "Same Name", city: "Ohio" }));
  assert.deepEqual(d.findDuplicateGroups(crowd), []);
  assert.equal(d.findDuplicateGroups(crowd.slice(0, 60)).length, 1, "sixty is still reviewable");
  // it stays fast on a big list
  const many = Array.from({ length: 4000 }, (_, i) => dl(1000 + i, { name: `Business Number ${i} Of Many`, city: `City ${i % 40}`, phone: `216555${String(i).padStart(4, "0")}` }));
  const t0 = Date.now();
  assert.deepEqual(d.findDuplicateGroups(many), []);
  assert.ok(Date.now() - t0 < 2000, "4,000 contacts in well under two seconds");
});

async function twin(name, extra = {}) {
  const r = await store.upsertPlace("aquila", { place_id: "osm:node/" + name.replace(/\W/g, "") + Math.random().toString(36).slice(2, 7), name, category: "bakery", category_label: "Bakery", address: "", city: "Mergeton", region: "MT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website", ...extra }, "shops in Mergeton, MT");
  return r.id;
}

test("merging moves everything to the contact you keep, fills blanks, and never loses a thing", async () => {
  const { query } = await import("../lib/db.js");
  const keep = await twin("Merge Bakery Alpha");
  const drop = await twin("Merge Bakery Alpha");
  const dropPlace = (await store.getLead("aquila", drop)).place_id;
  await store.updateLeadContact("aquila", keep, { contact_email: "", notes: "A note", status: "new" });
  await store.updateLeadContact("aquila", drop, { contact_email: "b@merge.example", notes: "B note", status: "contacted" });
  await store.setStage("aquila", drop, "replied");
  await store.addActivity("aquila", drop, { kind: "note", body: "call from B" });
  await store.addTask("aquila", drop, { title: "B task", dueOn: "2026-12-01" });
  await store.createMeeting("aquila", { leadId: drop, title: "B meeting", location: "phone", startsAt: new Date(2026, 11, 3, 10).toISOString() });
  const deal = await store.createDeal("aquila", drop, { title: "B deal", amountCents: 5000 });
  await store.saveDraft("aquila", keep, { subject: "keep draft", body: "x" });
  await store.saveDraft("aquila", drop, { subject: "drop draft", body: "y" });
  await query("UPDATE drafts SET status = 'sent', sent_at = ? WHERE lead_id = ?", [new Date().toISOString(), drop]);
  assert.deepEqual(await store.mergeLeads("aquila", keep, keep), { merged: false, reason: "Choose two different contacts." });
  assert.equal((await store.mergeLeads("other", keep, drop)).merged, false, "another brand cannot merge them");
  assert.ok(await store.getLead("aquila", drop), "a refused merge changes nothing");

  assert.deepEqual(await store.mergeLeads("aquila", keep, drop), { merged: true });
  assert.equal(await store.getLead("aquila", drop), null, "the duplicate is gone");
  const k = await store.getLead("aquila", keep);
  assert.equal(k.contact_email, "b@merge.example", "a blank is filled from the other contact");
  assert.equal(k.notes, "A note\n\nB note", "notes are joined, not replaced");
  assert.equal(k.stage, "meeting_booked", "the furthest stage wins (scheduling the meeting had already moved the duplicate past Replied)");
  assert.equal(k.status, "contacted");
  const acts = await store.listActivities("aquila", keep);
  assert.ok(acts.some((a) => a.body === "call from B"), "the timeline moved");
  assert.ok(acts.some((a) => /Merged with a duplicate: Merge Bakery Alpha/.test(a.body)), "and the merge is recorded");
  assert.equal((await store.tasksForLead("aquila", keep)).filter((t) => t.title === "B task").length, 1);
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM meetings WHERE lead_id = ? AND title = 'B meeting'", [keep]))[0].n, 1);
  assert.equal((await store.getDeal("aquila", deal)).lead_id, keep, "deals move too");
  const draft = await store.getDraftByLead("aquila", keep);
  assert.deepEqual([draft.subject, draft.status], ["drop draft", "sent"], "a draft that was sent is never lost to an unsent one");
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM drafts WHERE lead_id = ?", [keep]))[0].n, 1);
  // the scan finds the merged business again and treats it as the contact you kept
  const before = (await query("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = 'aquila'"))[0].n;
  const again = await store.upsertPlace("aquila", { place_id: dropPlace, name: "Merge Bakery Alpha", category: "bakery", category_label: "Bakery", address: "", city: "Mergeton", region: "MT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }, "x");
  assert.deepEqual(again, { created: false, id: keep, aliased: true });
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = 'aquila'"))[0].n, before, "no duplicate comes back");
});

test("merge rules: do not contact wins, a website is kept, clients are protected, and merges can chain", async () => {
  const { query } = await import("../lib/db.js");
  // do not contact wins, and a real website found on the other copy is kept
  const a = await twin("Merge Rules Beta");
  const b = await twin("Merge Rules Beta", { website: "https://beta.example/", website_kind: "site", bucket: "has_website" });
  await store.setLeadStatus("aquila", b, "do_not_contact");
  await store.mergeLeads("aquila", a, b);
  const m = await store.getLead("aquila", a);
  assert.equal(m.status, "do_not_contact", "someone who said no stays no");
  assert.deepEqual([m.website, m.bucket], ["https://beta.example/", "has_website"]);
  // closed: reopened if either copy is open, closed only if both are
  const c1 = await twin("Merge Rules Gamma");
  const c2 = await twin("Merge Rules Gamma");
  await store.setClosed("aquila", c1, true);
  await store.mergeLeads("aquila", c1, c2);
  assert.equal((await store.getLead("aquila", c1)).closed_at, null, "one open copy keeps the business open");
  const c3 = await twin("Merge Rules Delta");
  const c4 = await twin("Merge Rules Delta");
  await store.setClosed("aquila", c3, true);
  await store.setClosed("aquila", c4, true);
  await store.mergeLeads("aquila", c3, c4);
  assert.ok((await store.getLead("aquila", c3)).closed_at, "both closed stays closed");
  // clients: two clients cannot merge; one client moves to the kept contact
  const k1 = await twin("Merge Rules Epsilon");
  const k2 = await twin("Merge Rules Epsilon");
  await store.convertToClient("aquila", k1);
  await store.convertToClient("aquila", k2);
  const refused = await store.mergeLeads("aquila", k1, k2);
  assert.equal(refused.merged, false);
  assert.match(refused.reason, /Both of these are clients/);
  assert.ok(await store.getLead("aquila", k2), "nothing changed");
  const k3 = await twin("Merge Rules Zeta");
  const k4 = await twin("Merge Rules Zeta");
  const cl = await store.convertToClient("aquila", k4);
  assert.equal((await store.mergeLeads("aquila", k3, k4)).merged, true);
  assert.equal((await query("SELECT lead_id FROM clients WHERE id = ?", [cl.id]))[0].lead_id, k3, "the client now belongs to the contact you kept");
  // chains: X into Y, then Y into Z: X's map id now points at Z
  const x = await twin("Merge Rules Chain");
  const y = await twin("Merge Rules Chain");
  const z = await twin("Merge Rules Chain");
  const xPlace = (await store.getLead("aquila", x)).place_id;
  await store.mergeLeads("aquila", y, x);
  await store.mergeLeads("aquila", z, y);
  assert.equal((await query("SELECT lead_id FROM lead_aliases WHERE place_id = ?", [xPlace]))[0].lead_id, z);
  assert.equal((await store.mergeLeads("aquila", z, 99999999)).merged, false, "a contact that does not exist");
});

test("duplicate groups come from real contacts, dismissals stick, and deleting the survivor remembers merged places", async () => {
  const privacy = await import("../lib/privacy.js");
  const p = await twin("Group Bakery Omega");
  const q = await twin("Group Bakery Omega");
  const groups = await store.duplicateGroups("aquila");
  const g = groups.find((x) => x.ids.includes(p));
  assert.ok(g && g.ids.includes(q), "the two copies are offered together");
  assert.ok(g.reasons.includes("Same name in the same place"));
  assert.equal(g.members.length, g.ids.length);
  assert.ok(g.ids.includes(g.keep), "one is suggested to keep");
  assert.deepEqual(await store.duplicateGroups("nobody"), []);
  await store.dismissDuplicates("other", [p, q]);
  assert.ok((await store.duplicateGroups("aquila")).some((x) => x.ids.includes(p)), "another brand cannot dismiss them");
  await store.dismissDuplicates("aquila", [q, p, p]);
  assert.ok(!(await store.duplicateGroups("aquila")).some((x) => x.ids.includes(p)), "dismissed pairs are not offered again");
  // privacy: deleting a contact that had others merged into it must not let a scan recreate those
  const s1 = await twin("Group Delete Sigma");
  const s2 = await twin("Group Delete Sigma");
  const s2Place = (await store.getLead("aquila", s2)).place_id;
  await store.mergeLeads("aquila", s1, s2);
  assert.deepEqual(await privacy.deleteContact({ brandId: "aquila", leadId: s1 }), { deleted: true });
  const back = await store.upsertPlace("aquila", { place_id: s2Place, name: "Group Delete Sigma", category: "bakery", category_label: "Bakery", address: "", city: "Mergeton", region: "MT", phone: "", website: "", website_kind: "none", maps_url: "", bucket: "no_website" }, "x");
  assert.deepEqual(back, { created: false, id: null, skipped: true }, "the deleted business stays deleted, including the copy that was merged in");
});

// ---------------- tags, CSV import, saved views ----------------

test("tags are cleaned to a safe, short, lowercase form", async () => {
  const t = await import("../lib/tags.js");
  assert.equal(t.normalizeTag("  Coffee Shop "), "coffee shop");
  assert.equal(t.normalizeTag("Met @ Expo!!"), "met expo");
  assert.equal(t.normalizeTag("follow_up in spring"), "follow up in spring");
  assert.equal(t.normalizeTag("--x--"), "x");
  assert.equal(t.normalizeTag("a--b"), "a-b");
  assert.equal(t.normalizeTag("Café"), "caf", "only a to z and digits survive");
  assert.equal(t.normalizeTag("<script>alert(1)</script>"), "scriptalert1script", "markup is reduced to plain letters");
  for (const none of ["", "   ", null, undefined, "!!!", "x".repeat(31)]) assert.equal(t.normalizeTag(none), "");
  assert.equal(t.normalizeTag("x".repeat(30)), "x".repeat(30));
  assert.equal(t.normalizeTag(12345), "12345");
  assert.deepEqual(t.parseTagList("a, b; A\nc|d", 3), ["a", "b", "c"], "split on commas, semicolons, lines and bars; no repeats; limited");
  assert.deepEqual(t.parseTagList(",, ,;"), []);
  assert.deepEqual(t.parseTagList(null), []);
  assert.equal(t.MAX_TAGS_PER_CONTACT, 20);
});

test("CSV parsing handles quotes, commas, line breaks, and odd files without losing data", async () => {
  const c = await import("../lib/csvimport.js");
  assert.deepEqual(c.parseCsv("name,city\r\nJoe,Akron\r\n"), [["name", "city"], ["Joe", "Akron"]]);
  assert.deepEqual(c.parseCsv("name,notes\n\"Smith, Jo\",\"said \"\"hi\"\"\nthen left\"\n"), [["name", "notes"], ["Smith, Jo", "said \"hi\"\nthen left"]]);
  assert.deepEqual(c.parseCsv("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]], "a byte order mark and a missing final newline");
  assert.deepEqual(c.parseCsv("a,b\n\n,\n1,2\n\n"), [["a", "b"], ["1", "2"]], "blank and empty rows are dropped");
  assert.deepEqual(c.parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]], "empty fields stay in place");
  assert.deepEqual(c.parseCsv("a\r1\r2"), [["a"], ["1"], ["2"]], "old Mac line endings");
  assert.doesNotThrow(() => c.parseCsv("a,b\n\"never closed,1"), "an unterminated quote reads to the end");
  assert.deepEqual(c.parseCsv(""), []);
  assert.deepEqual(c.mapHeaders(["Business Name", "E-mail", "Phone Number", "Web Site", "ST", " TAGS ", "Extra"]), { name: 0, email: 1, phone: 2, website: 3, region: 4, tags: 5 });
  assert.deepEqual(c.mapHeaders(["company", "company name"]), { name: 0 }, "the first matching column wins");
  assert.deepEqual(c.mapHeaders(["foo"]), {});
});

test("CSV import analysis: every row is checked and duplicates are found, never added twice", async () => {
  const c = await import("../lib/csvimport.js");
  const existing = [{ id: 1, name: "Citizen Pie", city: "Cleveland", phone: "(216) 555-0100", contact_email: "", website: "https://citizenpie.com/", lat: null, lon: null }];
  const text = [
    "Business,Email,Phone,Website,City,State,Category,Notes,Tags",
    "Citizen Pie,,,,Cleveland,OH,Pizza,,",
    'New Bakery,NEW@bakery.example,330-555-0111,bakery.example,Akron,OH,Bakery,"likes mornings\nand tea","coffee, Met at Expo"',
    ",x@y.example,,,,,,,",
    "Bad Email Co,not-an-email,,,,,,,",
    'Bad Site Co,,,"not a url with spaces",,,,,',
    "New Bakery,other@x.example,(330) 555-0111,,Akron,OH,,,",
    "Phone Twin,,216-555-0100,,Cleveland,,,,",
  ].join("\n");
  const r = c.analyzeCsv(text, existing);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { total: 7, new: 2, duplicate: 2, invalid: 3 });
  const row = (n) => r.rows.find((x) => x.line === n);
  assert.equal(row(2).status, "duplicate");
  assert.match(row(2).reason, /Same name in the same place: Citizen Pie/);
  assert.deepEqual([row(3).status, row(3).email, row(3).website, row(3).tags], ["new", "new@bakery.example", "https://bakery.example/", ["coffee", "met at expo"]], "email lowercased, website completed, tags cleaned");
  assert.equal(row(3).notes, "likes mornings\nand tea", "a note with a line break survives");
  assert.deepEqual([row(4).status, row(4).reason], ["invalid", "No name."]);
  assert.deepEqual([row(5).status, row(5).reason], ["invalid", "The email address is not valid."]);
  assert.deepEqual([row(6).status, row(6).reason], ["invalid", "The website is not a valid address."]);
  assert.equal(row(7).status, "duplicate");
  assert.match(row(7).reason, /earlier in this file/, "the same business twice in one file");
  assert.equal(row(8).status, "new", "a shared phone with an unrelated name is not a duplicate");
  assert.deepEqual(r.columns.sort(), ["address", "category", "city", "email", "name", "notes", "phone", "region", "tags", "website"].filter((k) => k !== "address").sort());
  // files that cannot be used at all
  assert.match(c.analyzeCsv("name\n", []).error, /header row and at least one contact/);
  assert.match(c.analyzeCsv("", []).error, /header row/);
  assert.match(c.analyzeCsv("Foo,Bar\n1,2", []).error, /Name.*Found: Foo, Bar/);
  assert.match(c.analyzeCsv("name\na\nb\nc", [], { maxRows: 2 }).error, /3 rows.*limit is 2/);
  assert.match(c.analyzeCsv("name\n" + "x".repeat(c.MAX_CHARS), []).error, /too large/);
  // text that looks like a spreadsheet formula is only ever stored as text
  const f = c.analyzeCsv("name\n=HYPERLINK(\"http://evil\")", []);
  assert.equal(f.rows[0].name, "=HYPERLINK(\"http://evil\")");
  assert.equal(c.categorySlug("Hair & Beauty!"), "hair_beauty");
});

test("tags on contacts: add, remove, limits, filters, brand isolation, and a database rule behind them", async () => {
  const { query } = await import("../lib/db.js");
  const lf = await import("../lib/leadfilters.js");
  const lead = await seedVerifyLead("Tag Lead Verify19");
  assert.equal(await store.addTags("aquila", lead, ["Coffee Shop", "coffee shop", "Met at Expo", "!!!", ""]), 2, "cleaned, deduplicated, empty ones dropped");
  assert.deepEqual(await store.tagsForLead("aquila", lead), ["coffee shop", "met at expo"]);
  assert.equal(await store.addTags("other", lead, ["stolen"]), 0, "another brand cannot tag it");
  assert.equal(await store.addTags("aquila", 99999999, ["ghost"]), 0);
  assert.equal(await store.addTags("aquila", lead, ["coffee shop"]), 0, "already there");
  const many = await seedVerifyLead("Tag Limit Lead Verify19");
  assert.equal(await store.addTags("aquila", many, Array.from({ length: 25 }, (_, i) => `tag ${i}`)), 20, "twenty at most");
  assert.equal((await store.tagsForLead("aquila", many)).length, 20);
  const counts = await store.tagCounts("aquila");
  assert.ok(counts.find((x) => x.tag === "coffee shop").n >= 1);
  assert.deepEqual(await store.tagCounts("nobody"), []);
  const f = lf.parseFilters({ tag: "Coffee Shop", site: "any" });
  assert.equal(f.tag, "coffee shop");
  assert.ok((await store.searchLeads("aquila", f, { limit: 5000 })).some((l) => l.id === lead), "the filter finds tagged contacts");
  assert.ok(!(await store.searchLeads("aquila", lf.parseFilters({ tag: "met at expo", site: "any" }), { limit: 5000 })).some((l) => l.id === many));
  assert.equal(lf.hrefWith("/leads", lf.parseFilters({ tag: "coffee shop" }), {}), "/leads?tag=coffee+shop");
  assert.equal(lf.parseFilters({ tag: "<b>x</b>" }).tag, "bxb", "junk in the address is reduced to letters");
  assert.equal(lf.parseFilters({}).tag, "");
  await store.removeTag("other", lead, "coffee shop");
  assert.ok((await store.tagsForLead("aquila", lead)).includes("coffee shop"), "another brand cannot remove it");
  await store.removeTag("aquila", lead, "Coffee Shop");
  assert.deepEqual(await store.tagsForLead("aquila", lead), ["met at expo"]);
  await store.setClosed("aquila", lead, true);
  assert.ok(!(await store.tagCounts("aquila")).some((x) => x.tag === "met at expo" && x.n === 0), "closed contacts are not counted");
  await store.setClosed("aquila", lead, false);
  await assert.rejects(query("INSERT INTO lead_tags (brand_id, lead_id, tag, created_at) VALUES ('aquila', ?, 'Bad Tag!', 'x')", [lead]), "the database refuses a malformed tag too");
});

test("saved views keep only safe Prospects addresses, with limits", async () => {
  assert.deepEqual(await store.saveView("aquila", "  Akron   cafes ", "/leads?site=none&city=Akron&category=cafe", null), { saved: true });
  assert.deepEqual(await store.saveView("aquila", "Akron cafes", "/leads", null), { saved: false, reason: "A view with that name already exists." });
  for (const href of ["/redesign", "http://evil.example/", "//evil.example", "/leads?x=<script>", "/leads/12", "/leads?a=b c"]) {
    assert.equal((await store.saveView("aquila", "Bad " + href.length, href)).saved, false, href);
  }
  assert.equal((await store.saveView("aquila", "", "/leads")).saved, false);
  assert.equal((await store.saveView("aquila", "x".repeat(41), "/leads")).saved, false);
  const views = await store.listViews("aquila");
  assert.deepEqual(views.map((v) => v.name), ["Akron cafes"], "names are tidied");
  assert.deepEqual(await store.listViews("other"), []);
  await store.deleteView("other", views[0].id);
  assert.equal((await store.listViews("aquila")).length, 1, "another brand cannot delete it");
  for (let i = 0; i < 19; i++) assert.equal((await store.saveView("aquila", "View " + i, "/leads?site=any")).saved, true);
  assert.match((await store.saveView("aquila", "One too many", "/leads")).reason, /20 saved views/);
  await store.deleteView("aquila", views[0].id);
  assert.equal((await store.listViews("aquila")).length, 19);
  for (const v of await store.listViews("aquila")) await store.deleteView("aquila", v.id);
});

test("an import creates the contacts, and importing the same file again adds nothing", async () => {
  const c = await import("../lib/csvimport.js");
  const { query } = await import("../lib/db.js");
  const text = [
    "Name,Email,Phone,Website,City,State,Category,Notes,Tags",
    "Csv Import Bakery One,one@csvimport.example,330-555-0301,csvbakery1.example,Importville,IM,Hair & Beauty,first note,vip",
    "Csv Import Bakery Two,,330-555-0302,,Importville,IM,,,",
  ].join("\n");
  const a = c.analyzeCsv(text, await store.importComparisonLeads("aquila"));
  assert.deepEqual(a.counts, { total: 2, new: 2, duplicate: 0, invalid: 0 });
  await assert.rejects(store.importContacts("aquila", a.rows, { source: "kestrel" }), /where these contacts came from/, "only a hand-entered source is allowed");
  const ids = await store.importContacts("aquila", a.rows.filter((r) => r.status === "new"), { source: "referral", tagAll: ["imported"], userId: null });
  assert.equal(ids.length, 2);
  const one = await store.getLead("aquila", ids[0]);
  assert.deepEqual([one.name, one.contact_email, one.phone, one.city, one.region, one.source, one.owner_notes], ["Csv Import Bakery One", "one@csvimport.example", "330-555-0301", "Importville", "IM", "referral", "first note"]);
  assert.deepEqual([one.bucket, one.website, one.website_kind, one.category, one.category_label], ["has_website", "https://csvbakery1.example/", "site", "hair_beauty", "Hair & Beauty"], "a real website means it can be quality checked");
  const two = await store.getLead("aquila", ids[1]);
  assert.deepEqual([two.bucket, two.website, two.status, two.stage], ["unknown", null, "new", "new"]);
  assert.equal(one.place_id, null, "typed or imported contacts have no map id");
  assert.deepEqual(await store.tagsForLead("aquila", ids[0]), ["imported", "vip"], "the tag for everyone plus the row's own");
  assert.deepEqual(await store.tagsForLead("aquila", ids[1]), ["imported"]);
  assert.ok((await store.listActivities("aquila", ids[0])).some((x) => /Imported from a CSV file \(Referral\)/.test(x.body)));
  const again = c.analyzeCsv(text, await store.importComparisonLeads("aquila"));
  assert.deepEqual(again.counts, { total: 2, new: 0, duplicate: 2, invalid: 0 }, "the same file is now all duplicates");
  // a closed business is still known, so it is not added again either
  await store.setClosed("aquila", ids[1], true);
  assert.equal(c.analyzeCsv(text, await store.importComparisonLeads("aquila")).counts.duplicate, 2);
  // the parked file: brand scoped, and old ones are cleared
  const batch = await store.createImportBatch("aquila", { userId: null, source: "manual", tagAll: "x", csv: text });
  assert.equal((await store.getImportBatch("aquila", batch)).csv, text);
  assert.equal(await store.getImportBatch("other", batch), null);
  await query("UPDATE import_batches SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [batch]);
  const fresh = await store.createImportBatch("aquila", { userId: null, source: "manual", csv: "name\nx" });
  assert.equal(await store.getImportBatch("aquila", batch), null, "a batch older than a day is cleared");
  await store.deleteImportBatch("other", fresh);
  assert.ok(await store.getImportBatch("aquila", fresh), "another brand cannot delete it");
  await store.deleteImportBatch("aquila", fresh);
  assert.equal(await store.getImportBatch("aquila", fresh), null);
});

test("backups leave out the short lived import files, and deleting a contact removes its tags", async () => {
  const b = await import("../lib/backup.js");
  assert.ok(b.EXCLUDED_TABLES.includes("import_batches"));
  const fake = async (sql) => {
    if (/information_schema\.tables/.test(sql)) return [{ table_name: "leads" }, { table_name: "import_batches" }, { table_name: "lead_tags" }];
    if (/pg_constraint/.test(sql)) return [];
    if (/information_schema\.columns/.test(sql)) return [{ column_name: "id" }];
    return [];
  };
  assert.deepEqual((await b.dumpDatabase(fake)).manifest.order, ["lead_tags", "leads"]);
  const privacy = await import("../lib/privacy.js");
  const { query } = await import("../lib/db.js");
  const lead = await seedVerifyLead("Tag Delete Lead Verify20");
  await store.addTags("aquila", lead, ["gone soon"]);
  assert.deepEqual(await privacy.deleteContact({ brandId: "aquila", leadId: lead }), { deleted: true });
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM lead_tags WHERE lead_id = ?", [lead]))[0].n, 0);
});

// ---------------- bulk actions and search ----------------

test("bulk actions: only safe actions, only reasonable sizes, and every input is checked", async () => {
  const b = await import("../lib/bulk.js");
  assert.deepEqual(b.BULK_STAGES.map(([k]) => k), ["new", "contacted", "replied", "meeting_booked", "proposal_sent", "lost"], "won and not interested are not bulk actions");
  assert.equal(b.parseBulk({ ids: [], action: "skip" }).error, "Tick at least one contact first.");
  assert.equal(b.parseBulk({ action: "skip" }).ok, false);
  assert.deepEqual(b.parseBulk({ ids: ["a", "-1", "0", "3", "3", "4.5", 7], action: "close" }).value.ids, [3, 7], "junk and repeats are dropped");
  assert.equal(b.parseBulk({ ids: Array.from({ length: 200 }, (_, i) => i + 1), action: "skip" }).ok, true);
  assert.equal(b.parseBulk({ ids: Array.from({ length: 201 }, (_, i) => i + 1), action: "skip" }).error, "That is 201 contacts. Do 200 or fewer at a time.");
  assert.equal(b.parseBulk({ ids: [1], action: "" }).error, "Choose what to do with them.");
  assert.equal(b.parseBulk({ ids: [1], action: "delete" }).ok, false, "delete is not a bulk action");
  assert.equal(b.parseBulk({ ids: [1], action: "tag", tag: "" }).error, "Type the tag to add.");
  assert.deepEqual(b.parseBulk({ ids: [1], action: "tag", tag: "Coffee, VIP" }).value.tags, ["coffee", "vip"]);
  assert.equal(b.parseBulk({ ids: [1], action: "tag", tag: "a,b,c,d,e,f,g" }).value.tags.length, 5, "five tags at most at once");
  for (const stage of ["won", "not_interested", "bogus", ""]) assert.equal(b.parseBulk({ ids: [1], action: "stage", stage }).ok, false, stage);
  for (const stage of ["new", "contacted", "lost"]) assert.equal(b.parseBulk({ ids: [1], action: "stage", stage }).value.stage, stage);
  for (const action of ["skip", "unskip", "close", "reopen"]) assert.deepEqual(b.parseBulk({ ids: [2], action }), { ok: true, value: { ids: [2], action } });
  assert.equal(b.cleanQuery("  a "), "");
  assert.equal(b.cleanQuery("   "), "");
  assert.equal(b.cleanQuery(null), "");
  assert.equal(b.cleanQuery("  ab   cd "), "ab cd");
  assert.equal(b.cleanQuery("x".repeat(200)).length, 80);
  assert.equal(b.likePattern("50%_off!"), "%50!%!_off!!%", "percent, underscore and the escape character are plain text");
});

test("bulk updates go through the normal rules and stay inside the brand", async () => {
  const ids = [await seedVerifyLead("Bulk Lead A Verify21"), await seedVerifyLead("Bulk Lead B Verify21"), await seedVerifyLead("Bulk Lead C Verify21")];
  await store.setStage("aquila", ids[2], "contacted");
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "tag", tags: ["bulk test"] }), { changed: 3, total: 3 });
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "tag", tags: ["bulk test"] }), { changed: 0, total: 3 }, "already tagged");
  assert.deepEqual(await store.tagsForLead("aquila", ids[1]), ["bulk test"]);
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "stage", stage: "contacted" }), { changed: 2, total: 3 }, "one was already there");
  assert.equal((await store.getLead("aquila", ids[0])).stage, "contacted");
  assert.ok((await store.listActivities("aquila", ids[0])).some((a) => /moved|Stage|New to Contacted/i.test(a.body)), "the stage log records it as for a single contact");
  // skipping only touches contacts that are plainly new, and stop skipping only undoes a skip
  const fresh = [await seedVerifyLead("Bulk Lead D Verify21"), await seedVerifyLead("Bulk Lead E Verify21")];
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids: [...fresh, ids[2]], action: "skip" }), { changed: 2, total: 3 }, "a contact already contacted is left alone");
  assert.equal((await store.getLead("aquila", fresh[0])).status, "skipped");
  assert.equal((await store.getLead("aquila", ids[2])).status, "contacted");
  await store.setLeadStatus("aquila", fresh[1], "do_not_contact");
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids: fresh, action: "unskip" }), { changed: 1, total: 2 }, "do not contact is never undone in bulk");
  assert.equal((await store.getLead("aquila", fresh[1])).status, "do_not_contact");
  // closing rejects unsent drafts, once, and reopen undoes it
  await store.saveDraft("aquila", ids[0], { subject: "s", body: "b" });
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "close" }), { changed: 3, total: 3 });
  assert.equal((await store.getDraftByLead("aquila", ids[0])).status, "rejected");
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "close" }), { changed: 0, total: 3 }, "already closed");
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids, action: "reopen" }), { changed: 3, total: 3 });
  // another brand, and ids that do not exist, change nothing
  assert.deepEqual(await store.bulkUpdateLeads("other", { ids, action: "close" }), { changed: 0, total: 3 });
  assert.equal((await store.getLead("aquila", ids[0])).closed_at, null);
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids: [99999998, 99999999], action: "tag", tags: ["ghost"] }), { changed: 0, total: 2 });
  assert.deepEqual(await store.bulkUpdateLeads("aquila", { ids: [], action: "skip" }), { changed: 0, total: 0 });
});

test("search finds contacts, clients and deals by what is inside them, and treats typed symbols as plain text", async () => {
  const lead = await seedVerifyLead("Search Needle Bakery Verify22");
  await store.updateLeadContact("aquila", lead, { contact_email: "needle@searchfind.example", notes: "xyzzy-secret-phrase", status: "new" });
  await store.addTags("aquila", lead, ["needlefan"]);
  const clientLead = await seedVerifyLead("Search Client Lead Verify22");
  const cl = await store.createClient("aquila", { name: "Needle Client Verify22", email: "c@needle.example" });
  const deal = await store.createDeal("aquila", clientLead, { title: "Needle Deal Verify22", amountCents: 100 });
  const hit = await store.searchEverything("aquila", "needle");
  assert.ok(hit.leads.some((l) => l.id === lead), "found by name, email and tag");
  assert.ok(hit.clients.some((c) => c.id === cl), "clients");
  assert.ok(hit.deals.some((d) => d.id === deal && d.lead_name === "Search Client Lead Verify22"), "deals, with their contact");
  assert.ok((await store.searchEverything("aquila", "xyzzy-secret")).leads.some((l) => l.id === lead), "found inside private notes");
  assert.ok((await store.searchEverything("aquila", "NEEDLEFAN")).leads.some((l) => l.id === lead), "case does not matter");
  assert.ok((await store.searchEverything("aquila", "searchfind.example")).leads.some((l) => l.id === lead));
  // symbols are plain characters
  const a = await seedVerifyLead("Fifty% Off Cafe Verify22");
  const b = await seedVerifyLead("Fiftyx Off Cafe Verify22");
  const pct = (await store.searchEverything("aquila", "Fifty% Off")).leads.map((l) => l.id);
  assert.ok(pct.includes(a) && !pct.includes(b), "a percent sign is not a wildcard");
  const c = await seedVerifyLead("Snake_Case Cafe Verify22");
  const d = await seedVerifyLead("SnakexCase Cafe Verify22");
  const us = (await store.searchEverything("aquila", "Snake_Case")).leads.map((l) => l.id);
  assert.ok(us.includes(c) && !us.includes(d), "an underscore is not a wildcard");
  for (const evil of ["'; DROP TABLE leads; --", "\\", "!", "%%", "\" OR 1=1"]) await store.searchEverything("aquila", evil); // each must resolve, not reject
  assert.ok(await store.getLead("aquila", lead), "and nothing was dropped");
  // closed businesses are still found, after the open ones; another brand finds nothing; the limit holds
  await store.setClosed("aquila", lead, true);
  const sorted = (await store.searchEverything("aquila", "Search Needle")).leads;
  assert.ok(sorted.some((l) => l.id === lead && l.closed_at));
  assert.deepEqual(await store.searchEverything("other", "needle"), { leads: [], clients: [], deals: [] });
  assert.ok((await store.searchEverything("aquila", "Verify22", 3)).leads.length <= 3);
  await store.setClosed("aquila", lead, false);
});

test("duplicates: many stores of one chain in one city are never offered for merging (found on real scanned data)", async () => {
  const d = await import("../lib/dupes.js");
  const stores = Array.from({ length: 10 }, (_, i) => dl(200 + i, { name: "Starbucks", city: "Cleveland", phone: `+1 216-555-${String(1000 + i)}`, website: `https://www.starbucks.com/store-locator/store/${1000 + i}` }));
  assert.deepEqual(d.findDuplicateGroups(stores), [], "different phone numbers and different store pages: ten places, not one");
  const noPhones = Array.from({ length: 5 }, (_, i) => dl(300 + i, { name: "Starbucks", city: "Akron", website: `https://www.starbucks.com/store-locator/store/${2000 + i}` }));
  assert.deepEqual(d.findDuplicateGroups(noPhones), [], "different store pages alone are enough, with no phone numbers at all");
  const twoShops = [dl(400, { name: "Rising Star Coffee Roasters", city: "Cleveland", phone: "+1-216-273-3573", website: "http://www.risingstarcoffee.com" }), dl(401, { name: "Rising Star Coffee Roasters", city: "Cleveland", phone: "+1-216-242-6979", website: "https://risingstarcoffee.com/" })];
  assert.deepEqual(d.findDuplicateGroups(twoShops), [], "one business with two shops, each with its own phone");
  // genuine duplicates in the same data are still found
  const same = [
    dl(500, { name: "Great Clips", city: "Cleveland", website: "https://salons.greatclips.com/us/oh/cleveland/3772-rocky-river-dr" }),
    dl(501, { name: "Great Clips", city: "Cleveland", website: "https://salons.greatclips.com/us/oh/cleveland/3772-rocky-river-dr/" }),
    dl(502, { name: "Evelyn's Coffee & Banh Mi", city: "Akron", phone: "+13308495080" }),
    dl(503, { name: "Evelyn’s Coffee And Banh Mi", city: "Akron" }),
    dl(504, { name: "Citizen Pie", city: "Cleveland", website: "http://www.citizenpie.com/" }),
    dl(505, { name: "Citizen Pie", city: "Cleveland", website: "https://citizenpie.com" }),
    dl(506, { name: "Starbucks", city: "Cleveland", phone: "216-555-7777", website: "https://www.starbucks.com/store-locator/store/9" }),
    dl(507, { name: "Starbucks", city: "Cleveland", phone: "(216) 555-7777", website: "https://www.starbucks.com/store-locator/store/9" }),
  ];
  assert.deepEqual(d.findDuplicateGroups(same).map((g) => g.ids), [[500, 501], [502, 503], [504, 505], [506, 507]], "the same store listed twice is a duplicate");
  // a conflict also cancels a name match when only one side has a phone number? no: one missing phone is not a conflict
  assert.equal(d.duplicateReason(dl(1, { name: "Pie Place", city: "X", phone: "216-555-0001" }), dl(2, { name: "Pie Place", city: "X" })), "Same name in the same place");
  assert.equal(d.duplicateReason(dl(1, { name: "Pie Place", city: "X", website: "https://a.example/" }), dl(2, { name: "Pie Place", city: "X", website: "https://b.example/" })), null, "two different websites");
  assert.equal(d.duplicateReason(dl(1, { name: "Pie Place", city: "X", website: "https://a.example/menu" }), dl(2, { name: "Pie Place", city: "X", website: "https://a.example/" })), "Same name in the same place", "a home page and a menu page of one site");
});

test("a contact export includes their tags", async () => {
  const privacy = await import("../lib/privacy.js");
  const lead = await seedVerifyLead("Export Tags Lead Verify23");
  await store.addTags("aquila", lead, ["alpha tag", "beta tag"]);
  const x = await privacy.contactExport("aquila", lead);
  assert.deepEqual(x.tags, ["alpha tag", "beta tag"]);
});
