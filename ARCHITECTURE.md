# Architecture

## Requirements status

**Confirmed (from the brief):** Next.js App Router in JavaScript, Tailwind, Vercel, Resend; Places API not scraping; dedupe on Place ID; no-website vs has-website split; mockup per no-website lead following the website build standards; draft emails with human review; CAN-SPAM elements; branding kept out of core logic; per-brand data scoping.

**Assumptions (low risk, reversible):**
- Product name: **SiteScout** (`config/product.js`). The brief asked to pick one.
- Postgres (Neon or Vercel Postgres) in production via `pg`. Local dev and tests use embedded PGlite (real Postgres in WASM, dev dependency) when `DATABASE_URL` is unset. All SQL is plain Postgres.
- Custom session authentication (no auth library) built on Node crypto primitives: scrypt, AES-GCM, HMAC, TOTP. Reasoning: one small app, no external identity provider required, every piece unit tested. SSO (OIDC or SAML) is the upgrade path if multiple organizations or enterprise customers arrive.
- Social profiles and link-in-bio pages count as "no website".
- Mockup accent color is a neutral teal placeholder, not a confirmed brand color.
- Free OpenStreetMap (Nominatim + Overpass) is the default discovery source; Google Places is an optional paid provider (`DISCOVERY_PROVIDER`). Google Search pages are never scraped (Terms of Service).
- Google Text Search returns `websiteUri` directly, so Place Details calls are skipped.
- OSM-sourced leads are marked by a `osm:` place id prefix and carry a verify-first warning and ODbL attribution.

**Open questions:** sender identity and mailing address (env), target geography and categories, Aquila logo and colors, where to host for real sending, whether outreach targets include Canada or the EU (different consent law than CAN-SPAM; this app only implements CAN-SPAM basics and is not legal advice).

**Auth scope decisions:** roles are owner, administrator, member, scoped per brand. Email verification is covered by the invitation link and first-run setup rather than a separate verify step. No self-service signup.

**Out of scope for v1:** auto-send, multi-tenant logins, billing, a brand picker UI, email finding or enrichment, follow-up sequences, reply tracking.

## Layout

- `config/` brand and product identity. Only place a company name or color is defined.
- `lib/places.js`, `lib/discovery.js`, `lib/sites.js` Phase 1.
- `components/Mockup.jsx`, `lib/mockupCopy.js`, `app/m/[token]` Phase 2.
- `lib/email.js`, `lib/tokens.js`, `app/(admin)/actions.js` Phase 3.
- `lib/store.js`, `lib/db.js` the only data access (async, Postgres).
- `proxy.js` auth. Public paths: `/m/*`, `/unsubscribe*`, `/api/unsubscribe`, legal pages.

## Decisions

- Mockup is rendered on demand from the lead row, so there is no per-lead deploy to manage. The token is 128 random bits.
- Unsubscribe link in a draft is a placeholder resolved at send time because the signature is bound to the recipient address.
- Server actions validate with zod at the boundary; the send action re-checks every guardrail even though the button is disabled in the UI.
