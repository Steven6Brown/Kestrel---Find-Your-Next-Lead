// Free website quality audit. Downloads one page (the home page) and scores it against the things
// Aquila's own build standards care about: HTTPS, mobile layout, clear page structure, image
// descriptions, current markup, speed, a visible way to contact the business, and basic search
// and sharing tags. No account and no billing. Google PageSpeed Insights can be added for extra
// measured scores if a free key is set (PAGESPEED_API_KEY); without one, only these checks run.
//
// Sites come from open data, so they are untrusted: the fetcher refuses private network
// addresses (including after redirects and at connection time), limits size and time, and
// only ever makes plain GET requests.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

export const AUDIT_VERSION = 1;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;
const UA = "Mozilla/5.0 (compatible; KestrelAudit/1.0; one polite page request)";

/** True for addresses that must never be requested (loopback, private, link-local, unspecified). */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true;
}

/** dns lookup that refuses private results, so a hostile name cannot point us inside the network. */
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error("Blocked: address is not public"), { code: "EBLOCKED" }));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function requestOnce(url, { lookup = safeLookup, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return reject(Object.assign(new Error("Unsupported protocol"), { code: "EPROTO" }));
    if (net.isIP(u.hostname) && isPrivateAddress(u.hostname)) return reject(Object.assign(new Error("Blocked: address is not public"), { code: "EBLOCKED" }));
    const lib = u.protocol === "https:" ? https : http;
    const started = Date.now();
    const req = lib.request(u, { method: "GET", lookup, timeout: timeoutMs, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-encoding": "gzip, deflate" } }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        return resolve({ status, location: new URL(res.headers.location, u).toString(), ms: Date.now() - started });
      }
      let stream = res;
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      const chunks = [];
      let bytes = 0;
      stream.on("data", (c) => {
        bytes += c.length;
        if (bytes > MAX_BYTES) { req.destroy(Object.assign(new Error("Page too large to audit"), { code: "ETOOBIG" })); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, headers: res.headers, html: Buffer.concat(chunks).toString("utf8"), bytes, ms: Date.now() - started }));
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

/** Download a page, following a few redirects and checking every hop. */
export async function fetchPage(url, opts = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await requestOnce(current, opts);
    if (r.location) { current = r.location; continue; }
    return { ...r, finalUrl: current };
  }
  throw Object.assign(new Error("Too many redirects"), { code: "EREDIRECT" });
}

// ---------- the checks ----------

const tagAttr = (html, tag, attr) => {
  const out = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))) {
    const a = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(m[0]);
    out.push(a ? (a[2] ?? a[3] ?? a[4] ?? "") : null);
  }
  return out;
};
const metaContent = (html, key) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = /\b(?:name|property)\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
    if (k && k[1].toLowerCase() === key) {
      const c = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
      return c ? (c[2] ?? c[3] ?? "").trim() : "";
    }
  }
  return null;
};
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Score a downloaded page. `page` = { html, finalUrl, ms, bytes }. Returns { score, checks[] } where
 * each check is { id, label, points, max, note } and the points add up to the 0 to 100 score.
 */
export function analyzeHtml(page, { year = new Date().getFullYear() } = {}) {
  const html = String(page.html || "");
  const checks = [];
  const add = (id, label, max, points, note) => checks.push({ id, label, max, points: Math.max(0, Math.min(max, Math.round(points))), note });

  const secure = String(page.finalUrl || "").startsWith("https:");
  add("https", "Secure connection (HTTPS)", 10, secure ? 10 : 0, secure ? "Loads over HTTPS." : "Does not load over HTTPS, so browsers warn visitors it is not secure.");

  const viewport = metaContent(html, "viewport");
  add("viewport", "Built for phones", 15, viewport && /width\s*=\s*device-width/i.test(viewport) ? 15 : 0,
    viewport && /width\s*=\s*device-width/i.test(viewport) ? "Has a mobile layout setting." : "No mobile layout setting, so phones usually show a tiny desktop page.");

  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "").replace(/\s+/g, " ").trim();
  add("title", "Page title", 5, title.length >= 10 && title.length <= 70 ? 5 : title ? 3 : 0,
    title ? (title.length >= 10 && title.length <= 70 ? "Has a clear page title." : "Page title is very short or too long to show properly in search results.") : "No page title, which hurts search results and browser tabs.");

  const desc = metaContent(html, "description");
  add("description", "Search description", 5, desc && desc.length >= 50 ? 5 : desc ? 2 : 0,
    desc ? (desc.length >= 50 ? "Has a search description." : "Search description is too short to be useful.") : "No search description, so search engines guess what to show.");

  const h1 = (html.match(/<h1\b/gi) || []).length;
  add("h1", "One main heading", 5, h1 === 1 ? 5 : h1 > 1 ? 3 : 0, h1 === 1 ? "Has one main heading." : h1 > 1 ? "Has several main headings, which muddles the page structure." : "No main heading, so the page has no clear top level message.");

  const imgs = tagAttr(html, "img", "alt");
  const noAlt = imgs.filter((a) => a === null).length;
  add("alt", "Image descriptions", 8, imgs.length === 0 ? 8 : 8 * (1 - noAlt / imgs.length),
    imgs.length === 0 ? "No images to describe." : noAlt === 0 ? "Images have descriptions." : `${noAlt} of ${imgs.length} images have no description, which blocks screen reader users.`);

  const lang = /<html\b[^>]*\blang\s*=/i.test(html);
  add("lang", "Page language", 4, lang ? 4 : 0, lang ? "Language is declared." : "Language is not declared, which trips up screen readers and translation.");

  const old = [];
  if (/<font\b/i.test(html)) old.push("font tags");
  if (/<marquee\b|<blink\b/i.test(html)) old.push("scrolling or blinking text");
  if (/<frameset\b|<frame\b/i.test(html)) old.push("frames");
  if (/\.swf\b|<embed[^>]+flash|application\/x-shockwave-flash/i.test(html)) old.push("Flash");
  if ((html.match(/<table\b/gi) || []).length >= 4 && !/display\s*:\s*(grid|flex)|class\s*=\s*["'][^"']*(grid|flex|container|row)/i.test(html)) old.push("table based layout");
  if (/<center\b/i.test(html)) old.push("center tags");
  add("modern", "Current page code", 12, Math.max(0, 12 - old.length * 4), old.length ? `Uses older page code: ${old.join(", ")}.` : "No older page code found.");

  const ms = Number(page.ms) || 0;
  add("speed", "Loads quickly", 8, ms <= 1500 ? 8 : ms <= 3000 ? 5 : ms <= 6000 ? 2 : 0, `Home page arrived in ${(ms / 1000).toFixed(1)} seconds${ms > 3000 ? ", which is slow." : "."}`);

  const bytes = Number(page.bytes) || html.length;
  add("weight", "Page size", 4, bytes <= 500_000 ? 4 : bytes <= 1_000_000 ? 2 : 0, `Page code is ${Math.round(bytes / 1024)} KB${bytes > 500_000 ? ", which is heavy." : "."}`);

  const hasTel = /href\s*=\s*["']tel:/i.test(html);
  const hasMail = /href\s*=\s*["']mailto:/i.test(html);
  const hasForm = /<form\b/i.test(html);
  add("contact", "Easy to contact", 8, hasTel ? 8 : hasMail || hasForm ? 5 : 0,
    hasTel ? "Has a tap to call phone link." : hasMail || hasForm ? "Has an email link or form but no tap to call phone link." : "No phone link, email link or form found on the home page.");

  const text = strip(html);
  const years = [...text.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)].map((m) => Number(m[2] || m[1]));
  const latest = years.length ? Math.max(...years) : null;
  add("fresh", "Looks maintained", 6, latest === null ? 4 : latest >= year - 1 ? 6 : latest >= year - 3 ? 3 : 0,
    latest === null ? "No copyright year to judge freshness." : latest >= year - 1 ? `Footer year is ${latest}.` : `Footer still says ${latest}, so the site may look out of date.`);

  const ld = /application\/ld\+json/i.test(html) && /LocalBusiness|Restaurant|Store|Organization|HairSalon|Dentist|Plumber|Service/i.test(html);
  add("schema", "Business details for search engines", 5, ld ? 5 : 0, ld ? "Has structured business details." : "No structured business details, so search engines get less to show.");

  const og = metaContent(html, "og:title") !== null && metaContent(html, "og:image") !== null;
  add("share", "Looks good when shared", 5, og ? 5 : metaContent(html, "og:title") !== null ? 2 : 0, og ? "Has sharing preview tags." : "No sharing preview, so links shared on social media look bare.");

  const score = checks.reduce((n, c) => n + c.points, 0);
  return { score, checks };
}

/** Plain sentences for what is wrong, biggest loss first. */
export function reasonsFrom(checks, limit = 5) {
  return [...checks].filter((c) => c.points < c.max).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, limit).map((c) => c.note);
}

// ---------- optional: Google PageSpeed Insights (free key) ----------

/** Measured Lighthouse category scores (0 to 100), or null when no key is set or the call fails. */
export async function pageSpeed(url, { key = process.env.PAGESPEED_API_KEY, fetchImpl = fetch } = {}) {
  if (!key) return null;
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) api.searchParams.append("category", c);
  api.searchParams.set("key", key);
  try {
    const res = await fetchImpl(api, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return null;
    const cats = (await res.json())?.lighthouseResult?.categories;
    if (!cats) return null;
    const pct = (c) => (typeof c?.score === "number" ? Math.round(c.score * 100) : null);
    const out = { performance: pct(cats.performance), accessibility: pct(cats.accessibility), bestPractices: pct(cats["best-practices"]), seo: pct(cats.seo) };
    return Object.values(out).some((v) => v === null) ? null : out;
  } catch {
    return null;
  }
}

/**
 * Audit one site. Returns { status, score, checks, reasons, psi, finalUrl }.
 *   status "ok": scored. "unreachable": site would not load. "blocked": the site refused an automated
 *   visitor, so nothing is claimed about it and no score is given.
 */
export async function auditSite(url, { fetchPageFn = fetchPage, psiFn = pageSpeed } = {}) {
  let page;
  try {
    page = await fetchPageFn(url);
  } catch (err) {
    const code = err?.code || "";
    if (code === "EBLOCKED") return { status: "blocked", score: null, checks: [], reasons: ["Skipped: address is not a public website."], psi: null };
    if (["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "EREDIRECT"].includes(code) || /certificate/i.test(err?.message || "")) {
      return { status: "unreachable", score: null, checks: [], reasons: [`Would not load (${code || err.message}). Check it by hand before treating it as a lead.`], psi: null };
    }
    return { status: "unreachable", score: null, checks: [], reasons: [`Could not be checked (${code || err.message}).`], psi: null };
  }
  if (page.status === 401 || page.status === 403 || page.status === 429 || page.status === 999) {
    return { status: "blocked", score: null, checks: [], reasons: ["The site turns away automated visitors, so it could not be scored. Look at it by hand."], psi: null, finalUrl: page.finalUrl };
  }
  if (page.status >= 400) {
    return { status: "unreachable", score: null, checks: [], reasons: [`The home page returned an error (${page.status}). Check it by hand.`], psi: null, finalUrl: page.finalUrl };
  }
  // Pages assembled by scripts in the visitor's browser arrive almost empty. Scoring that empty shell
  // would wrongly claim there is no title, heading or contact link, so say so and do not score it.
  const visibleText = strip(String(page.html || "")).length;
  const scripts = (String(page.html || "").match(/<script\b/gi) || []).length;
  if (visibleText < 150 && (scripts >= 3 || /id\s*=\s*["'](root|__next|app)["']|ng-app|data-reactroot/i.test(page.html || ""))) {
    return { status: "script_built", score: null, checks: [], reasons: ["The page is built with scripts, so Kestrel cannot read it without a browser. Look at it by hand."], psi: null, finalUrl: page.finalUrl };
  }
  const { score: base, checks } = analyzeHtml(page);
  const psi = await psiFn(page.finalUrl || url);
  let score = base;
  if (psi) {
    const measured = (psi.performance + psi.accessibility + psi.bestPractices + psi.seo) / 4;
    score = Math.round((base + measured) / 2);
  }
  const reasons = reasonsFrom(checks);
  if (psi && psi.performance < 50) reasons.unshift(`Google measures mobile speed at ${psi.performance} out of 100.`);
  if (psi && psi.accessibility < 70) reasons.unshift(`Google measures accessibility at ${psi.accessibility} out of 100.`);
  return { status: "ok", score, checks, reasons: reasons.slice(0, 6), psi, finalUrl: page.finalUrl };
}
