# Architecture

## Requirements status

**Confirmed (from the brief):** Next.js App Router in JavaScript, Tailwind, Vercel, Resend; Places API not scraping; dedupe on Place ID; no-website vs has-website split; mockup per no-website lead following the website build standards; draft emails with human review; CAN-SPAM elements; branding kept out of core logic; per-brand data scoping.

**Assumptions (low risk, reversible):**
- Product name: **Kestrel** (`config/product.js`). The brief asked to pick one.
- Postgres (Neon or Vercel Postgres) in production via `pg`. Local dev and tests use embedded PGlite (real Postgres in WASM, dev dependency) when `DATABASE_URL` is unset. All SQL is plain Postgres.
- Custom session authentication (no auth library) built on Node crypto primitives: scrypt, AES-GCM, HMAC, TOTP. Reasoning: one small app, no external identity provider required, every piece unit tested. SSO (OIDC or SAML) is the upgrade path if multiple organizations or enterprise customers arrive.
- Social profiles and link-in-bio pages count as "no website".
- Mockup accent color is a neutral teal placeholder, not a confirmed brand color.
- Free OpenStreetMap (Nominatim + Overpass) is the default discovery source; Google Places is an optional paid provider (`DISCOVERY_PROVIDER`). Google Search pages are never scraped (Terms of Service).
- Google Text Search returns `websiteUri` directly, so Place Details calls are skipped.
- OSM-sourced leads are marked by a `osm:` place id prefix and carry a verify-first warning and ODbL attribution.

**Open questions:** sender identity and mailing address (env), target geography and categories, Aquila logo and colors, where to host for real sending, whether outreach targets include Canada or the EU (different consent law than CAN-SPAM; this app only implements CAN-SPAM basics and is not legal advice).

**Auth scope decisions:** roles are owner, administrator, member, scoped per brand. Email verification is covered by the invitation link and first-run setup rather than a separate verify step. No self-service signup.

**CRM core (branch crm-core), assumptions:**
- Non-Kestrel contacts (referrals, seminar contacts, website inquiries, manual adds) reuse the `leads` table, with `source`, `stage`, `owner_notes` added and `place_id` made optional. Manual contacts use bucket `unknown`. Chosen over a second `contacts` table to keep one pipeline and one timeline; reversible because every CRM query goes through `lib/store.js`.
- Replies are logged by hand for now. The timeline (`activities`, append only, no edit or delete) is shaped so an inbound connector can add `email_in` events later.
- Stages: new, contacted, replied, meeting_booked, proposal_sent, won, lost, not_interested. The older `status` column is kept in step (`statusForStage`) because scanning and sending still use it. Sending a draft moves `new` to `contacted`. Not interested, and any opt-out, writes to `suppressions` and rejects pending drafts.
- Follow-ups are `tasks` with a plain calendar day (`due_on`, local time), not a timestamp. There is no separate follow-up column on leads; the next follow-up is the earliest open task.
- The pipeline board shows people you are dealing with. A scanned business joins it once it has an outreach draft, so thousands of scanned businesses do not drown it.
- Every new table carries `brand_id` and every query filters on it (tested).

**Owner decisions (2026-11-05):** Google Calendar is the calendar to use (none set up yet) and Google Meet is the default meeting place. Kestrel runs only on the owner's computer for now, so nothing public (booking page, webhooks, OAuth redirects) can reach it. The PayPal Business account exists; the owner will create the sandbox app and keep credentials in `.env.local` (the live secret is never shared in chat).

**Consequences of running locally (assumptions, reversible):**
- Booking: until Kestrel is hosted at a public https address, prospects book through the owner's own Google Calendar booking link (to be stored as a setting and added to emails and concept pages). A native booking page with Google free/busy waits for hosting. Meetings are logged by hand meanwhile.
- PayPal: invoice status is fetched by a Reconcile button (and could be scheduled the same way scans are), not by webhooks, which need a public URL. Webhook handling is added once hosted.
- Meeting times are entered and shown in the server computer's time zone and stored as UTC.
- Currency is USD only for now.

**CRM step 3 (built):** clients (converted from a won contact, or added directly), projects with type, status, quoted amount in integer cents, dates and notes, manually logged meetings attached to a contact or a client (logging one moves an early-stage contact to Meeting booked), a Meetings page, meetings on the Today screen, and CSV exports of contacts, clients and projects. Cancelled projects are left out of client totals.

**CRM, deferred (not built yet, documented here so it is not silent scope):** the connector framework, the scheduler and booking page, PayPal invoicing, the inbound website form connector, automatic reply logging, contact export and delete, retention rules. See KESTREL-CRM-HANDOFF-BRIEF.md for the plan and the open questions.

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
