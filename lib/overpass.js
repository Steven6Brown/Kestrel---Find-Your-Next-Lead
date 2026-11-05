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
  const contact = process.env.OSM_CONTACT || process.env.SENDER_EMAIL || process.env.REPLY_TO_EMAIL;
  if (!contact) throw new Error("Set OSM_CONTACT (an email or URL) so OpenStreetMap services can identify you, as their usage policy requires.");
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

/** Same call shape as places.searchPlaces so discovery can use either source. */
export async function searchOverpass({ textQuery, location, category, fetchImpl = fetch }) {
  const cat = resolveCategory(category);
  if (!cat) {
    throw new Error(`"${category}" is not a supported free category. Supported: ${supportedCategories().join(", ")}.`);
  }
  const scope = await geocode(location, { fetchImpl });
  const res = await fetchImpl(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
    body: `data=${encodeURIComponent(buildQuery(cat.filter, scope))}`,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Overpass error ${res.status}${res.status === 429 || res.status === 504 ? " (the free server is busy, try again in a minute)" : ""}`);
  const data = await res.json();
  const cityFallback = location.split(",")[0].trim();
  void textQuery;
  return (data.elements || []).map((el) => normalizeElement(el, { categoryKey: cat.key, cityFallback })).filter(Boolean);
}
