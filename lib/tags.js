// Tags: short labels you put on contacts ("coffee", "met at expo", "follow up in spring"). Pure rules.
export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_CONTACT = 20;

/** One clean tag: lowercase letters, digits, spaces and hyphens, 1 to 30 characters. Anything else is removed. "" when nothing is left. */
export function normalizeTag(input) {
  const t = String(input ?? "")
    .toLowerCase()
    .replace(/[_–—]/g, " ")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s-]+|[\s-]+$/g, "");
  return t.length >= 1 && t.length <= MAX_TAG_LENGTH ? t : "";
}

/** A list typed or pasted as "a, b; c" (or one per line), cleaned and without repeats. At most `limit` tags. */
export function parseTagList(input, limit = 10) {
  const out = [];
  for (const part of String(input ?? "").split(/[,;\n\r|]+/)) {
    const t = normalizeTag(part);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
