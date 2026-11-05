// Free discovery source: OpenStreetMap. Nominatim turns "City, ST" into an area,
// Overpass returns named businesses of a category inside it. No API key, no billing.
//
// Honest limitation: OSM is volunteer-maintained. A missing `website` tag often means
// nobody added it, not that the business has no site. Treat OSM "no website" leads
// as candidates to verify by hand before outreach.
//
// Usage policy: Nominatim allows about 1 request per second and requires an
// identifying User-Agent with a contact. We send both and cache geocodes per run.
import { classifyWebsite } from "./sites.js";

export const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const OVERPASS = "https://overpass-api.de/api/interpreter";
export const RESULT_LIMIT = 150;

// Category (what you type) -> OSM tag filter. Only our own strings reach the query.
export const CATEGORIES = {
  plumber: '["craft"="plumber"]',
  electrician: '["craft"="electrician"]',
  hvac: '["craft"="hvac"]',
  roofer: '["craft"="roofer"]',
  carpenter: '["craft"="carpenter"]',
  painter: '["craft"="painter"]',
  locksmith: '["shop"="locksmith"]',
  landscaper: '["craft"="gardener"]',
  photographer: '["craft"="photographer"]',
  tailor: '["craft"="tailor"]',
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  bar: '["amenity"="bar"]',
  bakery: '["shop"="bakery"]',
  pizza: '["cuisine"="pizza"]',
  "hair salon": '["shop"="hairdresser"]',
  barber: '["shop"="hairdresser"]',
  "beauty salon": '["shop"="beauty"]',
  "nail salon": '["shop"="beauty"]["beauty"="nails"]',
  massage: '["shop"="massage"]',
  tattoo: '["shop"="tattoo"]',
  florist: '["shop"="florist"]',
  "gift shop": '["shop"="gift"]',
  "clothing store": '["shop"="clothes"]',
  jewelry: '["shop"="jewelry"]',
  "pet store": '["shop"="pet"]',
  hardware: '["shop"="hardware"]',
  laundromat: '["shop"="laundry"]',
  "dry cleaner": '["shop"="dry_cleaning"]',
  "auto repair": '["shop"="car_repair"]',
  "tire shop": '["shop"="tyres"]',
  "car wash": '["amenity"="car_wash"]',
  dentist: '["amenity"="dentist"]',
  veterinarian: '["amenity"="veterinary"]',
  gym: '["leisure"="fitness_centre"]',
  daycare: '["amenity"="kindergarten"]',
  accountant: '["office"="accountant"]',
  lawyer: '["office"="lawyer"]',
  "real estate": '["office"="estate_agent"]',
  insurance: '["office"="insurance"]',
};

const ALIASES = { plumbers: "plumber", plumbing: "plumber", electricians: "electrician", barbers: "barber", "barber shop": "barber", salon: "hair salon", restaurants: "restaurant", cafes: "cafe", coffee: "cafe", bakeries: "bakery", dentists: "dentist", lawyers: "lawyer", roofing: "roofer", landscaping: "landscaper", "mechanic": "auto repair", "car repair": "auto repair", gyms: "gym", flowers: "florist", "pet shop": "pet store" };

export function resolveCategory(input) {
  const k = String(input || "").trim().toLowerCase();
  const key = CATEGORIES[k] ? k : ALIASES[k];
  return key && CATEGORIES[key] ? { key, filter: CATEGORIES[key] } : null;
}

export const supportedCategories = () => Object.keys(CATEGORIES);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastNominatim = 0;

function userAgent() {
  // OSM policy needs an identifying contact. Default to the brand website; no email setup required.
  const contact = process.env.OSM_CONTACT || process.env.BRAND_WEBSITE || "https://www.aquiladigital.net";
  return `SiteScout/0.1 (${contact})`;
}

/** Geocode "City, ST" to an Overpass scope. Result is cached for the process. */
const geoCache = new Map();
export async function geocode(location, { fetchImpl = fetch, pace = true } = {}) {
  const key = location.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key);
  if (pace) {
    const wait = 1100 - (Date.now() - lastNominatim);
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
  }
  const url = `${NOMINATIM}?${new URLSearchParams({ q: location, format: "jsonv2", limit: "1" })}`;
  const res = await fetchImpl(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`);
  const hit = (await res.json())?.[0];
  if (!hit) throw new Error(`Could not find the location "${location}" on OpenStreetMap.`);
  let scope;
  if (hit.osm_type === "relation" && Number.isInteger(Number(hit.osm_id))) {
    scope = { area: 3600000000 + Number(hit.osm_id) };
  } else if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
    const [s, n, w, e] = hit.boundingbox.map(Number);
    if ([s, n, w, e].some(Number.isNaN)) throw new Error(`Bad bounding box for "${location}".`);
    scope = { bbox: [s, w, n, e] };
  } else {
    throw new Error(`"${location}" is too small or specific. Try a city or town name.`);
  }
  scope.label = String(hit.name || location);
  geoCache.set(key, scope);
  return scope;
}

export function buildQuery(filter, scope) {
  const body = scope.area
    ? `area(${scope.area})->.a;(nwr${filter}["name"](area.a););`
    : `(nwr${filter}["name"](${scope.bbox.join(",")}););`;
  return `[out:json][timeout:40];${body}out tags center ${RESULT_LIMIT};`;
}

/** Convert one OSM element to our lead shape. Tags are untrusted free text. */
export function normalizeElement(el, { categoryKey, cityFallback = "" }) {
  const t = el?.tags;
  if (!t || !t.name || !el.type || !el.id) return null;
  const site = t.website || t["contact:website"] || t.url || "";
  const social = t["contact:facebook"] || t["contact:instagram"] || t.facebook || t.instagram || "";
  const website = site || (social ? (/^https?:/.test(social) ? social : `https://www.facebook.com/${social}`) : "");
  const cls = classifyWebsite(website);
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const city = t["addr:city"] || cityFallback;
  const address = [street, city, t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ");
  return {
    place_id: `osm:${el.type}/${el.id}`,
    name: String(t.name).trim().slice(0, 200),
    category: categoryKey,
    category_label: categoryKey.replace(/\b\w/g, (c) => c.toUpperCase()),
    address,
    city,
    region: t["addr:state"] || "",
    phone: t.phone || t["contact:phone"] || "",
    website,
    website_kind: cls.kind,
    maps_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    bucket: cls.bucket,
    business_status: "",
  };
}

let lastOverpass = 0;
export const OVERPASS_MIRRORS = [OVERPASS, "https://overpass.kumi.systems/api/interpreter"];
const RETRYABLE = new Set([429, 502, 503, 504]);

/**
 * One Overpass query, paced to be polite to the free public servers. A busy server
 * (429, 502, 503, 504) is retried a few times, alternating between two public mirrors.
 */
export async function overpassRequest(ql, { fetchImpl = fetch, pace = true, retryDelayMs = 4000, attempts = 4 } = {}) {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    if (pace) {
      const wait = 2000 - (Date.now() - lastOverpass);
      if (wait > 0) await sleep(wait);
      lastOverpass = Date.now();
    }
    let res;
    try {
      res = await fetchImpl(OVERPASS_MIRRORS[i % OVERPASS_MIRRORS.length], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
        body: `data=${encodeURIComponent(ql)}`,
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      lastStatus = 0; // network error or timeout: treat like a busy server
    }
    if (res?.ok) return res.json();
    if (res && !RETRYABLE.has(res.status)) throw new Error(`Overpass error ${res.status}`);
    lastStatus = res?.status ?? 0;
    if (i < attempts - 1) await sleep(retryDelayMs * (i + 1));
  }
  throw new Error(`The free map servers are busy (error ${lastStatus || "timeout"}). Try again in a few minutes.`);
}

/** Same call shape as places.searchPlaces so discovery can use either source. */
export async function searchOverpass({ textQuery, location, category, fetchImpl = fetch }) {
  const cat = resolveCategory(category);
  if (!cat) {
    throw new Error(`"${category}" is not a supported free category. Supported: ${supportedCategories().join(", ")}.`);
  }
  const scope = await geocode(location, { fetchImpl });
  const data = await overpassRequest(buildQuery(cat.filter, scope), { fetchImpl });
  const cityFallback = location.split(",")[0].trim();
  void textQuery;
  return mergeDuplicates((data.elements || []).map((el) => normalizeElement(el, { categoryKey: cat.key, cityFallback })).filter(Boolean));
}

/**
 * OSM often has two entries for one business (a node and a building outline). If an
 * entry without a website shares a name with one that has a website, it is the same
 * business, so drop the website-less twin instead of reporting a false lead.
 */
export function mergeDuplicates(places) {
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const withSite = new Set(places.filter((p) => p.bucket === "has_website").map((p) => norm(p.name)));
  return places.filter((p) => p.bucket === "has_website" || !withSite.has(norm(p.name)));
}
