// Importing contacts from a spreadsheet saved as CSV. Pure: text in, a checked list out. Nothing is written here.
// Every row is validated, and a row that matches a contact you already have (or an earlier row) is marked as a
// duplicate instead of being added twice. The server re-checks everything at import time, never trusting a preview.
import { normalizeUrl } from "./matchsites.js";
import { buildIndex, findMatch } from "./dupes.js";
import { parseTagList } from "./tags.js";

export const MAX_ROWS = 2000;
export const MAX_CHARS = 2_000_000;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

/** RFC 4180 style CSV: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF, a leading byte order mark. */
export function parseCsv(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") { quoted = true; any = true; }
    else if (c === ",") { row.push(field); field = ""; any = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      if (any || field !== "" || row.length) { row.push(field); rows.push(row); }
      row = []; field = ""; any = false;
    } else { field += c; any = true; }
  }
  if (any || field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const ALIASES = {
  name: ["name", "business", "business name", "company", "company name", "organization", "organisation"],
  email: ["email", "email address", "e-mail", "e mail"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell"],
  website: ["website", "web site", "url", "web", "site", "web address"],
  city: ["city", "town"],
  region: ["state", "region", "province", "st"],
  address: ["address", "street", "street address", "address 1"],
  category: ["category", "type", "industry", "business type"],
  notes: ["notes", "note", "comments", "comment"],
  tags: ["tags", "tag", "labels", "label"],
};

/** Which column holds which field, by header name (any case, extra spaces ignored). */
export function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim().toLowerCase().replace(/[_\s]+/g, " ");
    for (const [field, names] of Object.entries(ALIASES)) if (!(field in map) && names.includes(key)) map[field] = i;
  });
  return map;
}

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const slug = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/**
 * Check a CSV. `existing` are the contacts already in Kestrel (id, name, city, phone, contact_email, website, lat, lon).
 * Returns { ok: false, error } for a file that cannot be read at all, otherwise { ok: true, rows, counts, columns } where each row is
 * { line, status: "new" | "duplicate" | "invalid", reason, ...fields }.
 */
export function analyzeCsv(text, existing = [], { maxRows = MAX_ROWS } = {}) {
  if (String(text ?? "").length > MAX_CHARS) return { ok: false, error: "That file is too large. Split it into smaller files." };
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "The file needs a header row and at least one contact." };
  const map = mapHeaders(table[0]);
  if (!("name" in map)) return { ok: false, error: `The file needs a column called Name (or Business, Company). Found: ${table[0].map((h) => h.trim()).filter(Boolean).join(", ") || "no headers"}.` };
  if (table.length - 1 > maxRows) return { ok: false, error: `That file has ${(table.length - 1).toLocaleString()} rows. The limit is ${maxRows.toLocaleString()} at a time, so split it.` };

  const index = buildIndex(existing);
  const seen = buildIndex([]);
  const rows = [];
  table.slice(1).forEach((cells, k) => {
    const get = (f) => (f in map ? cells[map[f]] ?? "" : "");
    const line = k + 2;
    const website = clip(get("website"), 300);
    const row = {
      line,
      name: clip(get("name"), 200),
      email: clip(get("email"), 200).toLowerCase(),
      phone: clip(get("phone"), 40),
      website: "",
      city: clip(get("city"), 120),
      region: clip(get("region"), 40),
      address: clip(get("address"), 200),
      category: clip(get("category"), 80),
      notes: String(get("notes") ?? "").trim().slice(0, 4000),
      tags: parseTagList(get("tags")),
      status: "new",
      reason: "",
    };
    if (!row.name) return rows.push({ ...row, status: "invalid", reason: "No name." });
    if (row.email && !EMAIL_RE.test(row.email)) return rows.push({ ...row, status: "invalid", reason: "The email address is not valid." });
    if (website) {
      const u = normalizeUrl(website);
      if (!u) return rows.push({ ...row, status: "invalid", reason: "The website is not a valid address." });
      row.website = u;
    }
    const candidate = { id: -line, name: row.name, city: row.city, phone: row.phone, contact_email: row.email, website: row.website, lat: null, lon: null };
    const hit = findMatch(index, candidate) || findMatch(seen, candidate);
    if (hit) return rows.push({ ...row, status: "duplicate", reason: `${hit.reason}: ${hit.lead.name}${hit.lead.id < 0 ? " (earlier in this file)" : ""}` });
    seen.add(candidate);
    rows.push(row);
  });
  const counts = { total: rows.length, new: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) counts[r.status]++;
  return { ok: true, rows, counts, columns: Object.keys(map) };
}

export { slug as categorySlug };
