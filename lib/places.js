// Google Places API (New) Text Search client. This is the sanctioned, official
// way to read business listings. We never scrape Google result pages.
//
// Text Search can return `websiteUri` directly via the field mask, so a separate
// Place Details call per result is not needed (one billed request returns it all).
import { classifyWebsite } from "./sites.js";

export const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

function component(components, type, short = false) {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  if (!c) return "";
  return (short ? c.shortText : c.longText) || "";
}

/** Convert one raw Places API place into our lead shape. Raw data is untrusted. */
export function normalizePlace(p) {
  if (!p || typeof p.id !== "string" || !p.id) return null;
  const name = p.displayName?.text;
  if (typeof name !== "string" || !name.trim()) return null;
  const site = classifyWebsite(typeof p.websiteUri === "string" ? p.websiteUri : "");
  const comps = p.addressComponents;
  return {
    place_id: p.id,
    name: name.trim().slice(0, 200),
    category: typeof p.primaryType === "string" ? p.primaryType : "",
    category_label:
      typeof p.primaryTypeDisplayName?.text === "string" ? p.primaryTypeDisplayName.text : "",
    address: typeof p.formattedAddress === "string" ? p.formattedAddress : "",
    city: component(comps, "locality") || component(comps, "postal_town") || component(comps, "sublocality"),
    region: component(comps, "administrative_area_level_1", true),
    phone: typeof p.nationalPhoneNumber === "string" ? p.nationalPhoneNumber : "",
    website: typeof p.websiteUri === "string" ? p.websiteUri : "",
    website_kind: site.kind,
    maps_url: typeof p.googleMapsUri === "string" ? p.googleMapsUri : "",
    bucket: site.bucket,
    business_status: p.businessStatus || "",
  };
}

/**
 * Run a text query, following pagination up to maxPages (20 results per page).
 * Returns normalized, operational places only.
 */
export async function searchPlaces({ apiKey, textQuery, maxPages = 1, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set.");
  const pages = Math.min(Math.max(Number(maxPages) || 1, 1), 3);
  const out = [];
  let pageToken;
  for (let i = 0; i < pages; i++) {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json())?.error?.message || "";
      } catch {
        /* ignore */
      }
      throw new Error(`Places API error ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await res.json();
    for (const raw of data.places || []) {
      const place = normalizePlace(raw);
      if (place && place.business_status !== "CLOSED_PERMANENTLY") out.push(place);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
