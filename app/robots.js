// Internal tool plus unlisted concept pages: ask crawlers to stay out entirely.
export default function robots() {
  return { rules: { userAgent: "*", disallow: "/" } };
}
