// Platform rules in one place. Pure data and pure checks, so they can be tested without a network.
// These limits are conservative working values. Platforms change them; re-check each platform's current
// documentation before relying on an edge case (see ARCHITECTURE.md, Social module).

export const PLATFORM_IDS = ["facebook", "instagram", "linkedin", "tiktok"];

export const PLATFORMS = {
  facebook: { id: "facebook", name: "Facebook Page", maxChars: 5000, maxHashtags: 10, image: { w: 1200, h: 630 }, needsImage: false, direct: true },
  instagram: { id: "instagram", name: "Instagram", maxChars: 2200, maxHashtags: 30, image: { w: 1080, h: 1350 }, needsImage: true, direct: true },
  linkedin: { id: "linkedin", name: "LinkedIn (personal profile)", maxChars: 3000, maxHashtags: 5, image: { w: 1200, h: 627 }, needsImage: false, direct: true },
  tiktok: { id: "tiktok", name: "TikTok (assisted)", maxChars: 2200, maxHashtags: 10, image: { w: 1080, h: 1920 }, needsImage: false, direct: false },
};

export const isPlatform = (p) => PLATFORM_IDS.includes(p);

/** "#Tag" list as a clean array: letters, digits, underscore only, no duplicates. */
export function parseHashtags(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const out = [];
  for (const t of raw) {
    const clean = String(t).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out;
}
export const hashtagText = (tags) => parseHashtags(tags).map((t) => `#${t}`).join(" ");

/** Exactly the text that will be posted: caption, then hashtags, then the tracked link. */
export function finalText({ caption = "", hashtags = "", link = "" }) {
  return [String(caption).trim(), hashtagText(hashtags), link ? String(link).trim() : ""].filter(Boolean).join("\n\n");
}

/** Whole words or phrases from the owner's never say list found in the text (case insensitive). */
export function findNeverSay(text, neverSay) {
  const list = (Array.isArray(neverSay) ? neverSay : String(neverSay || "").split(/\r?\n|,/)).map((s) => s.trim()).filter(Boolean);
  const hay = String(text || "");
  return list.filter((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(hay));
}

/**
 * Checks one variant against its platform. `problems` block approval; `warnings` do not.
 * variant: { platform, caption, hashtags, link, hasImage, neverSay }
 */
export function checkVariant(v) {
  const p = PLATFORMS[v.platform];
  const problems = [];
  const warnings = [];
  if (!p) return { problems: ["Unknown platform."], warnings, length: 0 };
  const tags = parseHashtags(v.hashtags);
  const text = finalText({ caption: v.caption, hashtags: tags, link: v.link });
  if (!String(v.caption || "").trim()) problems.push("The caption is empty.");
  if (text.length > p.maxChars) problems.push(`Too long for ${p.name}: ${text.length} of ${p.maxChars} characters.`);
  if (tags.length > p.maxHashtags) problems.push(`Too many hashtags for ${p.name}: ${tags.length} of ${p.maxHashtags}.`);
  if (p.needsImage && !v.hasImage) problems.push(`${p.name} needs an image.`);
  if (!p.needsImage && !v.hasImage && p.direct) warnings.push("No image. A text only post is allowed here.");
  const banned = findNeverSay(text, v.neverSay);
  if (banned.length) problems.push(`Contains words on your never say list: ${banned.join(", ")}.`);
  if (/[<>]/.test(text) && /<\/?[a-z][^>]*>/i.test(text)) warnings.push("Looks like HTML. Platforms show it as plain text.");
  return { problems, warnings, length: text.length };
}

/** The pre approval checklist the owner must tick (brief section 5). */
export const CHECKLIST = ["Claims verified, nothing invented", "Client permission, if a client is shown", "Links are correct"];
