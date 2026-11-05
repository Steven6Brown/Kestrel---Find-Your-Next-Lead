// Lets you pick cities from buttons instead of typing them. Given a state, ask
// OpenStreetMap for its cities and towns (largest first) and return them as choices.
import { geocode, overpassRequest } from "./overpass.js";
import { STATES } from "./campaigns.js";

const cache = new Map(); // state code -> { at, cities }
const TTL = 24 * 60 * 60 * 1000;
export const CITY_LIMIT = 40;

export function rankCities(elements, limit = CITY_LIMIT) {
  const seen = new Set();
  return (elements || [])
    .filter((e) => e?.tags?.name)
    .map((e) => ({ name: String(e.tags.name).trim(), population: Number.parseInt(e.tags.population, 10) || 0 }))
    .filter((c) => c.name.length >= 2 && c.name.length <= 60 && !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function citiesForState(code, { fetchImpl = fetch, pace = true } = {}) {
  const state = STATES.find(([c]) => c === code);
  if (!state) throw new Error("Unknown state.");
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.cities;
  const scope = await geocode(`${state[1]}, United States`, { fetchImpl, pace });
  if (!scope.area) throw new Error(`Could not load the area for ${state[1]}.`);
  const ql = `[out:json][timeout:40];area(${scope.area})->.a;node["place"~"^(city|town)$"]["name"](area.a);out tags 600;`;
  const data = await overpassRequest(ql, { fetchImpl, pace });
  const cities = rankCities(data.elements);
  if (cities.length) cache.set(code, { at: Date.now(), cities });
  return cities;
}
