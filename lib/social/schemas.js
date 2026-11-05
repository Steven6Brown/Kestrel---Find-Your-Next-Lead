// Validation for everything that enters the Social module. Imported drafts come from a chat the owner ran
// elsewhere, so they are untrusted data: parsed against these schemas and landed as drafts only.
import { z } from "zod";
import { PLATFORM_IDS, parseHashtags } from "./platforms.js";

// Strip control characters (keeps newline and tab) so pasted text cannot smuggle odd characters into posts or images.
export const clean = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n/g, "\n");

const text = (max) => z.string().transform(clean).transform((s) => s.trim()).pipe(z.string().max(max));
const tags = z.union([z.array(z.string().max(60)).max(60), z.string().max(1500)]).transform((t) => parseHashtags(t).join(" "));

export const variantSchema = z.object({
  platform: z.enum(PLATFORM_IDS),
  caption: text(5000),
  hashtags: tags.optional().default(""),
  script: text(4000).optional().default(""),
  image: z.object({ headline: text(90).optional().default(""), subline: text(160).optional().default(""), cta: text(40).optional().default("") }).optional(),
});

export const importPostSchema = z.object({
  app: text(80).optional(),
  topic: text(140).pipe(z.string().min(1)),
  goal: text(200).optional().default(""),
  variants: z.array(variantSchema).min(1).max(4),
});

/**
 * Accepts one post, a list of posts, or { posts: [...] }, as JSON text, optionally inside a markdown code fence.
 * Returns { ok: true, posts } or { ok: false, error }. Never throws.
 */
export function parseImport(raw) {
  let s = clean(raw).trim();
  if (!s) return { ok: false, error: "Paste the JSON first." };
  if (s.length > 200_000) return { ok: false, error: "That is too large to import. Paste fewer posts at a time." };
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    return { ok: false, error: "That is not valid JSON. Ask the AI to answer with JSON only, in the format shown on this page." };
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.posts) ? data.posts : [data];
  if (list.length > 20) return { ok: false, error: "Import at most 20 posts at a time." };
  const posts = [];
  for (const [i, item] of list.entries()) {
    const r = importPostSchema.safeParse(item);
    if (!r.success) {
      const issue = r.error.issues[0];
      return { ok: false, error: `Post ${i + 1}: ${issue.path.join(".") || "value"} ${issue.message.toLowerCase()}.` };
    }
    const seen = new Set();
    for (const v of r.data.variants) {
      if (seen.has(v.platform)) return { ok: false, error: `Post ${i + 1}: ${v.platform} appears twice.` };
      seen.add(v.platform);
    }
    posts.push(r.data);
  }
  return { ok: true, posts };
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must look like #C08A2E");
export const appSchema = z.object({
  name: text(60).pipe(z.string().min(1, "is required")),
  tagline: text(140).optional().default(""),
  website: z.string().trim().max(300).refine((u) => !u || /^https:\/\//i.test(u), "must start with https://").optional().default(""),
  store_url: z.string().trim().max(300).refine((u) => !u || /^https:\/\//i.test(u), "must start with https://").optional().default(""),
  primary_color: color.optional().default("#C08A2E"),
  dark_color: color.optional().default("#0B0E13"),
  tone: text(400).optional().default(""),
  never_say: text(800).optional().default(""),
  ctas: text(600).optional().default(""),
  hashtags: z.string().max(600).transform((t) => parseHashtags(t).join(" ")).optional().default(""),
  link_hosts: z.string().max(400).optional().default(""),
});

export const variantEditSchema = z.object({
  caption: text(5000),
  hashtags: z.string().max(1500).transform((t) => parseHashtags(t).join(" ")).default(""),
  script: text(4000).default(""),
  link_target: z.string().trim().max(500).default(""),
  image_headline: text(90).default(""),
  image_subline: text(160).default(""),
  image_cta: text(40).default(""),
});

export const idSchema = z.coerce.number().int().positive();
