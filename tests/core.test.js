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
