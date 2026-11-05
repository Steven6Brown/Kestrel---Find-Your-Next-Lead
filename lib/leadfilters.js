// Filtering for the leads database. Every filter is a pick from a fixed list (or a value
// that must already exist in the data), so there is nothing to type and nothing unsafe to
// put in a query: values are allowlisted here and always passed as SQL parameters.

export const SITE = [["any", "Any website status"], ["none", "No website"], ["social", "Social page only"], ["has", "Has a website"]];
export const PHONE = [["any", "Any"], ["yes", "Has a phone number"]];
export const CHECK = [["any", "Any"], ["unchecked", "Needs a website check"], ["confirmed", "Confirmed no website"]];
export const STATUS = [["any", "Any"], ["new", "New"], ["contacted", "Contacted"], ["skipped", "Skipped"], ["do_not_contact", "Do not contact"]];
export const OPEN_STATE = [["open", "Open businesses"], ["closed", "Closed businesses"]];
export const PAGE_SIZE = 50;
export const STAGE_FILTER = [["any", "Any stage"], ["new", "New"], ["contacted", "Contacted"], ["replied", "Replied"], ["meeting_booked", "Meeting booked"], ["proposal_sent", "Proposal sent"], ["won", "Won"], ["lost", "Lost"], ["not_interested", "Not interested"]];

const pick = (v, list, dflt = "any") => (list.some(([k]) => k === v) ? v : dflt);
const slug = (v) => (typeof v === "string" && /^[a-z0-9_]{1,60}$/.test(v) ? v : "");
const text = (v) => (typeof v === "string" ? v.slice(0, 80) : "");

/** Turn URL search params into a clean filter object. Unknown values fall back to "any". */
export function parseFilters(sp = {}) {
  return {
    site: pick(sp.site, SITE, "none"),
    phone: pick(sp.phone, PHONE),
    check: pick(sp.check, CHECK),
    status: pick(sp.status, STATUS),
    stage: pick(sp.stage, STAGE_FILTER),
    open: pick(sp.open, OPEN_STATE, "open"),
    ready: sp.ready === "1" ? "1" : "",
    category: slug(sp.category),
    city: text(sp.city),
    page: Math.max(1, Number.parseInt(sp.page, 10) || 1),
  };
}

const OSM = "COALESCE(l.place_id, '') LIKE 'osm:%'";

/** SQL WHERE (with ? placeholders) for a filter set. `skip` leaves one facet out, for facet counts. */
export function buildWhere(brandId, f, skip = "") {
  const where = ["l.brand_id = ?"];
  const args = [brandId];
  where.push(f.open === "closed" ? "l.closed_at IS NOT NULL" : "l.closed_at IS NULL");
  if (f.site === "none") where.push("l.bucket = 'no_website'");
  if (f.site === "has") where.push("l.bucket = 'has_website'");
  if (f.site === "social") where.push("l.website_kind = 'social'");
  if (f.phone === "yes") where.push("COALESCE(l.phone, '') <> ''");
  if (f.check === "unchecked") where.push(`l.bucket = 'no_website' AND ${OSM} AND l.site_check = 'unchecked'`);
  if (f.check === "confirmed") where.push("l.site_check = 'confirmed_none'");
  if (f.status !== "any") { where.push("l.status = ?"); args.push(f.status); }
  if (f.stage !== "any") { where.push("l.stage = ?"); args.push(f.stage); }
  if (f.ready) {
    // Ready for outreach: no website, verified where the data source needs it, not opted out or skipped.
    where.push(`l.bucket = 'no_website' AND (NOT ${OSM} OR l.site_check = 'confirmed_none') AND l.status NOT IN ('do_not_contact','skipped')`);
  }
  if (f.category && skip !== "category") { where.push("l.category = ?"); args.push(f.category); }
  if (f.city && skip !== "city") { where.push("l.city = ?"); args.push(f.city); }
  return { where: where.join(" AND "), args };
}

/** Link to the same page with some filters changed (and back to page 1). */
export function hrefWith(base, f, changes = {}) {
  const next = { ...f, page: 1, ...changes };
  const q = new URLSearchParams();
  if (next.site !== "none") q.set("site", next.site);
  if (next.phone !== "any") q.set("phone", next.phone);
  if (next.check !== "any") q.set("check", next.check);
  if (next.status !== "any") q.set("status", next.status);
  if (next.stage !== "any") q.set("stage", next.stage);
  if (next.open === "closed") q.set("open", "closed");
  if (next.ready) q.set("ready", "1");
  if (next.category) q.set("category", next.category);
  if (next.city) q.set("city", next.city);
  if (next.page > 1) q.set("page", String(next.page));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** One CSV cell, quoted, with spreadsheet formula injection neutralized. */
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
