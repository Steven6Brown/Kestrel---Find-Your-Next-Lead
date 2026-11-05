// Decides whether a listing counts as having a real website.
// Assumption (documented in ARCHITECTURE.md): a listing whose only "website" is a
// social profile or link-in-bio page is treated as NO real website, but flagged.

const SOCIAL_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linktr.ee",
  "linktree.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "yelp.com",
  "youtube.com",
  "nextdoor.com",
  "business.google.com",
  "g.page",
  "google.com",
];

export function hostOf(uri) {
  try {
    return new URL(uri).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifyWebsite(uri) {
  if (!uri || !String(uri).trim()) return { bucket: "no_website", kind: "none" };
  const host = hostOf(uri);
  if (!host) return { bucket: "no_website", kind: "none" };
  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { bucket: "no_website", kind: "social" };
  }
  return { bucket: "has_website", kind: "site" };
}
