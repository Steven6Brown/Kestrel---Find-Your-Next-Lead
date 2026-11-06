// Doing one thing to many contacts at once, and finding things. Pure rules: what is allowed, and a safe search pattern.
import { STAGES } from "./crm.js";
import { parseTagList } from "./tags.js";

export const MAX_BULK = 200;
export const BULK_ACTIONS = [
  ["tag", "Add a tag"],
  ["stage", "Move to a stage"],
  ["skip", "Skip for now"],
  ["unskip", "Stop skipping"],
  ["close", "Mark closed"],
  ["reopen", "Reopen"],
];
// Won needs a client and a project (use Deals), and Not interested also blocks the person's email, so neither is a bulk action.
export const BULK_STAGES = STAGES.filter(([k]) => !["won", "not_interested"].includes(k));

/** Check what a bulk form sent. Returns { ok: true, value: { ids, action, tags?, stage? } } or { ok: false, error }. */
export function parseBulk(input) {
  const ids = [...new Set((input.ids || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return { ok: false, error: "Tick at least one contact first." };
  if (ids.length > MAX_BULK) return { ok: false, error: `That is ${ids.length} contacts. Do ${MAX_BULK} or fewer at a time.` };
  const action = BULK_ACTIONS.find(([k]) => k === input.action)?.[0];
  if (!action) return { ok: false, error: "Choose what to do with them." };
  if (action === "tag") {
    const tags = parseTagList(input.tag, 5);
    if (!tags.length) return { ok: false, error: "Type the tag to add." };
    return { ok: true, value: { ids, action, tags } };
  }
  if (action === "stage") {
    const stage = BULK_STAGES.find(([k]) => k === input.stage)?.[0];
    if (!stage) return { ok: false, error: "Choose a stage. Won and Not interested are set one contact at a time." };
    return { ok: true, value: { ids, action, stage } };
  }
  return { ok: true, value: { ids, action } };
}

/** What a person typed into the search box, cleaned: one line, at most 80 characters, at least 2. "" when unusable. */
export function cleanQuery(q) {
  const s = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return s.length >= 2 ? s : "";
}

/** A LIKE pattern that matches the text as typed, so a % or _ in the search is a plain character. Pair with ESCAPE '!'. */
export const likePattern = (q) => `%${q.replace(/[!%_]/g, (c) => "!" + c)}%`;
