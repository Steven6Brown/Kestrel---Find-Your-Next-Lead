// Campaigns are saved scan profiles: which business types, which cities, how often.
// Every value is chosen from a fixed list (no free text), so there is nothing to mistype
// and nothing untrusted reaches the query.
import { CATEGORIES } from "./overpass.js";

export const CATEGORY_GROUPS = [
  ["Trades", ["plumber", "electrician", "hvac", "roofer", "carpenter", "painter", "locksmith", "landscaper"]],
  ["Food and drink", ["restaurant", "cafe", "bar", "bakery", "pizza"]],
  ["Beauty and wellness", ["hair salon", "barber", "beauty salon", "nail salon", "massage", "tattoo"]],
  ["Retail", ["florist", "gift shop", "clothing store", "jewelry", "pet store", "hardware"]],
  ["Auto", ["auto repair", "tire shop", "car wash"]],
  ["Health and fitness", ["dentist", "veterinarian", "gym", "daycare"]],
  ["Professional services", ["accountant", "lawyer", "real estate", "insurance", "photographer", "tailor", "laundromat", "dry cleaner"]],
];

export const STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

export const FREQUENCIES = [
  ["manual", "Manual only"],
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly (Monday)"],
];

export const RUN_TIMES = [
  ["02:00", "2 AM"],
  ["06:00", "6 AM"],
  ["12:00", "Noon"],
  ["22:00", "10 PM"],
];

export const MAX_CATEGORIES = 8;
export const MAX_LOCATIONS = 10;
export const MAX_COMBOS = 40;

export const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const STATE_CODES = new Set(STATES.map(([c]) => c));
const FREQ = new Set(FREQUENCIES.map(([k]) => k));
const TIMES = new Set(RUN_TIMES.map(([k]) => k));
const LOCATION_RE = /^[\p{L}0-9 .'’-]{2,60}, [A-Z]{2}$/u;

/** Validate a submitted campaign. Returns { ok, value } or { ok:false, error }. */
export function validateCampaign({ categories, locations, frequency, run_time }) {
  const cats = [...new Set(categories || [])];
  const locs = [...new Set(locations || [])];
  if (!cats.length) return { ok: false, error: "Pick at least one business type." };
  if (!locs.length) return { ok: false, error: "Pick at least one city." };
  if (cats.length > MAX_CATEGORIES) return { ok: false, error: `Pick at most ${MAX_CATEGORIES} business types.` };
  if (locs.length > MAX_LOCATIONS) return { ok: false, error: `Pick at most ${MAX_LOCATIONS} cities.` };
  if (!cats.every((c) => Object.hasOwn(CATEGORIES, c))) return { ok: false, error: "Unknown business type." };
  if (!locs.every((l) => LOCATION_RE.test(l) && STATE_CODES.has(l.slice(-2)))) return { ok: false, error: "Unknown city." };
  if (cats.length * locs.length > MAX_COMBOS) {
    return { ok: false, error: `${cats.length} types times ${locs.length} cities is ${cats.length * locs.length} searches. The limit is ${MAX_COMBOS} per run.` };
  }
  const freq = FREQ.has(frequency) ? frequency : "manual";
  const time = TIMES.has(run_time) ? run_time : "06:00";
  return { ok: true, value: { categories: cats, locations: locs, frequency: freq, run_time: time } };
}

export function campaignName(categories, locations) {
  const c = titleCase(categories[0]) + (categories.length > 1 ? ` +${categories.length - 1}` : "");
  const l = locations[0] + (locations.length > 1 ? ` +${locations.length - 1}` : "");
  return `${c} in ${l}`;
}

export const frequencyLabel = (f) => FREQUENCIES.find(([k]) => k === f)?.[1] || "Manual only";
export const timeLabel = (t) => RUN_TIMES.find(([k]) => k === t)?.[1] || t;

/** Next scheduled run as a Date (local time), or null for manual campaigns. */
export function nextRun(frequency, runTime, from = new Date()) {
  if (frequency === "manual") return null;
  const [h, m] = runTime.split(":").map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d <= from) continue;
    const dow = d.getDay();
    if (frequency === "daily") return d;
    if (frequency === "weekdays" && dow >= 1 && dow <= 5) return d;
    if (frequency === "weekly" && dow === 1) return d;
  }
  return null;
}

/** The one-line PowerShell command that registers this campaign with Windows Task Scheduler. */
export function registerCommand(id, frequency, runTime) {
  const sched = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" }[frequency];
  if (!sched) return null;
  return `.\\scripts\\register-task.ps1 -CampaignId ${id} -Schedule ${sched} -Time ${runTime}`;
}
