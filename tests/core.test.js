import test from "node:test";
import assert from "node:assert/strict";

process.env.PGLITE_DIR = "memory";
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
const { runDiscovery } = await import("../lib/discovery.js");
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
  const many = Array.from({ length: 11 }, (_, i) => `c${i}`);
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
