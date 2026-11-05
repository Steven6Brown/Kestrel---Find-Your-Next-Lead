// Deterministic graphics: an SVG card filled with text, rendered to PNG by sharp. Free, on brand and consistent.
// No AI image generation. Flat colors only (no gradients), as the brand rules require.
import { PLATFORMS } from "./platforms.js";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Greedy word wrap by estimated character width. Returns at most maxLines lines; the last one ends with an ellipsis if cut. */
export function wrap(text, maxChars, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:!?\s]*$/, "").slice(0, Math.max(1, maxChars - 1)) + "…";
    return kept;
  }
  return out;
}

/** Relative luminance, to pick readable text on the brand color. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const readableOn = (bg) => (luminance(bg) > 0.4 ? "#0B0E13" : "#FFFFFF");

/** The SVG for a card. kit: { name, primary_color, dark_color }, content: { headline, subline, cta }. */
export function cardSvg({ width, height, kit, content }) {
  const primary = HEX.test(kit.primary_color) ? kit.primary_color : "#C08A2E";
  const dark = HEX.test(kit.dark_color) ? kit.dark_color : "#0B0E13";
  const onDark = "#FFFFFF";
  const onPrimary = readableOn(primary);
  const pad = Math.round(width * 0.075);
  const big = Math.round(width * (height > width ? 0.082 : 0.058));
  const small = Math.round(big * 0.46);
  const maxChars = Math.floor((width - pad * 2) / (big * 0.52));
  const head = wrap(content.headline || kit.name, maxChars, height > width ? 7 : 4);
  const sub = wrap(content.subline || "", Math.floor((width - pad * 2) / (small * 0.5)), 3);
  const lineH = Math.round(big * 1.18);
  const blockH = head.length * lineH;
  const startY = Math.round(height * 0.3);
  const headSvg = head.map((l, i) => `<text x="${pad}" y="${startY + i * lineH}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${big}" fill="${onDark}">${esc(l)}</text>`).join("");
  const subY = startY + blockH + Math.round(small * 0.6);
  const subSvg = sub.map((l, i) => `<text x="${pad}" y="${subY + i * Math.round(small * 1.4)}" font-family="Arial, Helvetica, sans-serif" font-size="${small}" fill="${onDark}" fill-opacity="0.85">${esc(l)}</text>`).join("");
  const barH = Math.round(height * 0.07);
  const cta = String(content.cta || "").trim();
  const ctaW = Math.min(width - pad * 2, Math.round(cta.length * small * 0.62 + small * 2));
  const ctaH = Math.round(small * 2.3);
  const ctaY = height - pad - barH - ctaH;
  const ctaSvg = cta
    ? `<rect x="${pad}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH / 2)}" fill="${primary}"/><text x="${pad + Math.round(small)}" y="${ctaY + Math.round(ctaH * 0.64)}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${small}" fill="${onPrimary}">${esc(cta.slice(0, 40))}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${dark}"/><rect x="0" y="0" width="${Math.round(width * 0.02)}" height="${height}" fill="${primary}"/>${headSvg}${subSvg}${ctaSvg}<rect x="0" y="${height - barH}" width="${width}" height="${barH}" fill="${primary}"/><text x="${pad}" y="${height - Math.round(barH * 0.3)}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(barH * 0.46)}" fill="${onPrimary}">${esc(kit.name)}</text></svg>`;
}

/** Renders the card for a platform at its required size. Returns a PNG Buffer. */
export async function renderCard({ platform, kit, content }) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error("Unknown platform.");
  const { default: sharp } = await import("sharp");
  const svg = cardSvg({ width: spec.image.w, height: spec.image.h, kit, content });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Validates and re-encodes an uploaded image. Decoding it for real proves it is an image; re-encoding drops all
 * metadata (including GPS). Returns { ok, buffer, mime } or { ok: false, error }.
 */
export async function sanitizeUpload(buf) {
  if (!buf || !buf.length) return { ok: false, error: "Choose an image file." };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, error: "That image is over 5 MB. Use a smaller one." };
  try {
    const { default: sharp } = await import("sharp");
    const img = sharp(buf, { limitInputPixels: 40_000_000 });
    const meta = await img.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format)) return { ok: false, error: "Only JPEG, PNG and WebP images are allowed." };
    const out = await img.rotate().jpeg({ quality: 88 }).toBuffer(); // rotate() applies the EXIF orientation, then metadata is dropped
    return { ok: true, buffer: out, mime: "image/jpeg" };
  } catch {
    return { ok: false, error: "That file could not be read as an image." };
  }
}
