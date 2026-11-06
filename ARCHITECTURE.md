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

**Connections (built):** `lib/connectors/` has one registry and one shape for every outside service (id, name, mode, check). Modes: `setting` (a value the owner saves, currently the booking link), `env` (credentials stay in environment variables and are never stored or shown: PayPal, Resend), and `unavailable` (Google Calendar, until hosting). The `connections` table records status, non-secret config, last check and last error; any secret a future connector needs is AES-GCM encrypted at rest (`saveConnection` / `readConnectionSecret`) and never returned by list or get. The Connections page is owner and administrator only, and connect, test and disconnect are written to the audit log. PayPal's check requests a token from the sandbox (or live, only when PAYPAL_ALLOW_LIVE=1) and discards it; messages never contain credentials. The booking link is validated (https, public host, no embedded credentials), added to new outreach drafts, shown on concept pages, and shown on a contact's page to paste into replies. Kestrel never fetches that link.

**PayPal invoicing (built, tested against a stand-in only):** `lib/paypal.js` is a small Invoicing API v2 client (token with caching and one refresh retry, create draft with `PayPal-Request-Id` for safe retries, send, get; every reply validated with zod, errors reduced to short safe messages). `lib/invoicing.js` and `lib/invoicestatus.js` hold the rules and the service. Decisions: amounts are computed on the server from the project's quoted amount in integer cents (full, 50% deposit, or remaining balance, never more than quoted in total); a local `invoices` row is reserved before calling PayPal so a failed create can be retried with the same request id and never double-bills; creating a draft and sending are separate steps, and sending needs a confirmation tick, owner or administrator only; status is only changed by reconcile, which re-reads the invoice from PayPal and writes a timeline entry once, on the step where it becomes paid. Payment status without webhooks comes from a Reconcile button on Today and Invoices. Creates, sends and reconciles are audited. Invoice links shown to you are accepted only if they are https pages on paypal.com. Cancelling or refunding invoices from Kestrel is not built, because PayPal's cancel call was not documented clearly enough to implement safely. Stored: PayPal invoice id and number, status, amount, currency, dates, and the client email you already had; never card or bank data.

**Calendar (built):** a month calendar page (`/calendar`) that shows meetings, open follow-ups, invoices due (owners and administrators only), and scheduled scans, plus a day panel to schedule a meeting by picking a contact or client from a list. It is server rendered with plain links for navigation (no client JavaScript), a table grid on wide screens and a day-by-day list on phones. Item rules live in `lib/calendar.js` (pure, tested) and the queries in `calendarItems` in the store. Days are local calendar days in the server computer's time zone, as with tasks and meetings. A download of meetings as an .ics file (`lib/ics.js`: RFC 5545 escaping, 75 byte line folding, UTC times, sanitized UIDs, a fixed 30 minute length because meetings have no end time) lets the owner import them into Google Calendar without any hosting or sign-in. Two way Google Calendar sync still waits for hosting.

**CRM, deferred (not built yet, documented here so it is not silent scope):** the native booking page and Google Calendar connector, PayPal webhooks, cancelling invoices, the inbound website form connector, automatic reply logging, contact export and delete, retention rules. See KESTREL-CRM-HANDOFF-BRIEF.md for the plan and the open questions.

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

## Website quality audit (free)
`lib/audit.js` downloads one home page per lead that has its own website and scores it with 14 weighted checks that add to 100 (`analyzeHtml`: HTTPS 10, phone layout 15, title 5, description 5, one h1 5, image alt 8, language 4, current markup 12, speed 8, size 4, contact links 8, footer year 6, structured data 5, share tags 5). Results are stored on `leads` (audit_status, audit_score, audit_json, audited_at; rechecked after 60 days). Statuses: ok, unreachable, blocked (403, 401, 429 or private address), script_built (page is an empty shell until scripts run, so it cannot be judged), chain and listing (skipped by `lib/chains.js` before any request). Only status ok has a score, and only a score below the cutoff makes a redesign target (`lib/redesign.js`, cutoffs 50, 60, 70, 80 from buttons). `lib/auditrun.js` runs three sites at a time in the background with a 25 minute limit and records a run with trigger audit. With `PAGESPEED_API_KEY` set, Google's four Lighthouse scores are averaged with the page checks; without it nothing is sent to Google.

## Deals
`lib/deals.js` is pure (stages and their usual chances, input validation, weighted value, and `computeForecast`), and the SQL lives in the deals block of `lib/store.js` over the `deals` table (database checks on stage, type, reason, probability 0 to 100 and amount up to $20 million). A deal belongs to a contact (`lead_id`, deleted with it) and is created with an INSERT from the contact row so it cannot attach to another brand's contact. `moveDeal` resets the chance to the stage's figure and moves the contact forward to Proposal sent (never backward). `winDeal` makes the client (if needed) and a project (in progress, at the deal's amount), records `project_id`, then marks the deal won, so a failure never leaves a won deal without its project; winning twice does nothing. `loseDeal` needs one of six reasons and moves the contact to Lost only when no other deal is open. The forecast puts overdue deals in an Overdue bucket, the next six months by month, and Later, and reports deals with no date or no amount instead of guessing. Win rate uses `rate()` from `lib/insights.js`.

## Backups, export and delete
`lib/backup.js` asks the database for its tables (so new tables are included automatically, minus sessions and auth_tokens), orders them parents first from the foreign keys, and writes one gzipped JSON file with a manifest (format, counts, SHA-256 of the data, whether the app secret is included). With BACKUP_PASSPHRASE the bytes are encrypted (KBKE1 header, scrypt salt, AES-256-GCM). Files are `kestrel-backup-YYYYMMDD-HHMMSS.kbk.gz|enc` in BACKUP_DIR or the data folder; the newest 30 are kept. `restoreSnapshot` only fills an empty database, inserts parents first, and resets id sequences; `scripts/restore-backup.mjs` opens a new local database folder for it. It works through plain Postgres queries, so the same code can dump a hosted database. The scheduled backup is `/api/cron/backup` (shared bearer check in `lib/cronauth.js`). `lib/privacy.js` holds the contact export (everything about one contact, brand scoped) and the delete: the do not contact entry and a `deleted_places` row are written first, an empty client record goes with the contact, a client with projects blocks the delete, and the database cascades drafts, timeline, tasks and meetings. `upsertPlace` skips any place in `deleted_places`.

## Insights
`lib/insights.js` is pure: rows in, numbers out (periods, time buckets, funnel, outreach by template, where wins come from, speed, money). `store.insightsRows` reads only what it needs for one brand (money tables only when asked, so a member never causes them to be read) and closed businesses are excluded. How far a contact got is the furthest of: a draft exists, an email was sent, the current stage, and every stage in the stage log, so a contact later lost still counts at the steps it passed and every step is a subset of the one before. Replies, meetings and wins come only from stage changes. Money counts sent, non cancelled invoices in USD (other currencies are counted and reported, never added in). `rate()` carries the counts and flags fewer than 20 as small, and `rateText` never prints a bare percentage for those. `drafts.kind` (no_website or redesign) is set when a draft is made and backfilled once from the lead type. Charts (`components/Charts.jsx`, `lib/chartmath.js`) are plain SVG using theme variables, with a table of the same numbers.

## Layout, navigation and themes
`components/AppShell.jsx` frames every signed in page: a sidebar on large screens and a Menu button (`MobileMenu`, a details element that closes after you pick a page) on phones. The menu is data in `lib/nav.js` (groups in work order, one matching rule, Settings pages, initials), and `NavLinks` marks the current page with aria-current. `lib/nextstep.js` ranks what is waiting (follow-ups due, drafts to review, approved to send, websites to check, sites to score, then scan) and `NextStep` shows the best one, skipping the page you are on. `lib/prospecttabs.js` holds the Prospects tabs. Themes: `app/globals.css` defines one set of color names (`--k-*`, exposed as Tailwind colors) with a light default and `:root[data-theme="dark"]`. The root layout reads the `ks_theme` cookie (exactly "dark" or anything else is light, `lib/theme.js`), so the server renders the right theme. Pages use only the named colors, never hex, so both themes follow. The sidebar is navy in both. Settings is at `/settings` because `/setup` is the first owner sign up route.

## Redesign concept and email
A lead qualifies (`isRedesignLead` in `lib/redesign.js`) when its own website has audit_status ok, a score, and it is not do not contact. `/m/[token]` serves the existing concept page for no website leads and, for qualifying leads, the same page plus a findings section from `auditOf` (reasons and score come only from the stored audit, with its date). `buildRedesignDraft` in `lib/email.js` writes the email (at most three findings, the check's limits, the concept link, booking link only if saved, same footer, address, STOP and unsubscribe token). `makeDraft` picks the template by bucket. All send guardrails in `sendProblems` apply unchanged. Bulk drafting (`draftRedesignAction`) is capped at 200 and skips leads that already have a draft or are skipped.

## Website verification (free)
OpenStreetMap often lacks website tags, so a scanned business can look website-less when it is not. `lib/verify.js` groups unverified OSM leads by search area, geocodes the area for a bounding box, and reads Overture Maps places in that box (`lib/overture.js`, DuckDB reading public parquet files, no key or billing). `lib/matchsites.js` holds the pure matching rules (phone plus similar name or nearby; very similar name and nearby; very similar name in the same city when coordinates are missing). A found website sets bucket has_website with website_source overture; a social page stays no_website with kind social; nothing found only stamps overture_checked_at (rechecked after 30 days). People's confirmed verdicts and already-checked leads are never changed, and rescans do not erase a found website. Runs are recorded in `runs` with trigger verify.


## Social module (organic posts for each app)

**Status:** built and tested against stand-ins only. No live Facebook, Instagram or LinkedIn call has been made (see TESTING.md).

**Confirmed (owner):** organic posts only, no paid ads; Facebook, Instagram, LinkedIn, TikTok; built inside Kestrel; human approval before anything posts; drafts come from templates, from text pasted from an AI chat (free), or from the AI writing page (paid, added later at the owner's request, see below); each mobile app has its own accounts; LinkedIn personal profile first; TikTok assisted.

**Decisions and assumptions (change if wrong):**
- **Inside Kestrel, not separate software.** It reuses sign-in, roles, audit log, encryption, the cron secret pattern and the approval habit. Separate software would duplicate all of that and need its own hosting.
- **One `social_apps` row per mobile app** (brand kit and accounts). `brand_id` stays the Kestrel tenant (Aquila Digital) on every table, because users and sign-in are scoped by it. Making each app its own `brand_id` would break sign-in.
- **`social_accounts` instead of the shared `connections` table**, because `connections` is unique per (brand, provider) and each app needs its own account per platform.
- **Accounts connect by pasting an id and a token** (encrypted at rest), not OAuth. OAuth needs a public https redirect and an approved developer app per platform. Pasting needs neither, and is the smaller attack surface. OAuth with a state parameter is the upgrade path once hosted.
- **Approval is per platform variant** (`social_variants.status`), not per post, so one platform can fail or be rejected without blocking the others.
- **Images live in Postgres** (`social_assets`, at most 5 MB, re-encoded so EXIF and GPS are gone) to avoid a paid storage service. Video upload is not built; the owner uploads TikTok video by hand.
- **Graphics are SVG cards rendered by sharp.** Fonts are Arial/Helvetica fallbacks from the host machine; check the look on any new host.
- **Scheduling needs something running.** Locally, Windows Task Scheduler must call `POST /api/cron/social` with `Authorization: Bearer CRON_SECRET` every 5 to 15 minutes, and Kestrel must be running. Times are entered in the server's time zone (a hosted server is usually UTC).
- Instagram and Facebook fetch images from a public https URL, so publishing those needs Kestrel hosted with `APP_BASE_URL` set. LinkedIn uploads the image bytes directly.
- API versions come from `META_GRAPH_VERSION` and `LINKEDIN_API_VERSION` (defaults are guesses and must be checked).

**Files:** `lib/social/` (platforms rules, zod schemas, templates, graphics, links and signed media, adapters, service with the approval gate and publisher), `lib/socialstore.js` (all SQL, brand scoped), `app/(admin)/social/` (pages and server actions), public `app/l/[code]` and `app/sm/[token]`, `app/api/cron/social`.

**Not built:** OAuth, video upload and direct video posting, TikTok direct posting, LinkedIn company pages, an inbound website form that sets lead source automatically (inquiries are counted by hand for now), AI generation provider (the interface point is the Import page).
### AI writing (added at the owner's request)
- **Remote inference** through the Anthropic API (`lib/social/ai.js`, official `@anthropic-ai/sdk`). Costs money per call; the owner accepted this and said quality matters more than cost. Default model `claude-opus-5-5` (about 4 USD in and 20 USD out per million tokens at last check of the pricing table); `SOCIAL_AI_MODEL` overrides it.
- **Spending cap:** `ai_usage` totals per month, default cap 5 USD (a default I chose, since no budget was given; change `SOCIAL_AI_MONTHLY_CAP_USD`). Before each call the worst case (input plus the full output allowance) must fit under the cap. The figure shown is an estimate from published prices, not the Anthropic bill; set a limit in the Anthropic console too.
- **What is sent:** the app's brand kit and the idea and facts typed on the page. Never contacts, client data, CRM notes or secrets.
- **Trust:** the reply is untrusted. It is parsed with the same zod schema as imported drafts, retried once if malformed, filtered to the chosen platforms, and saved as drafts only. The system prompt forbids invented statistics, testimonials, prices and claims and tells the AI that typed text is information, not instructions. The approval checklist and never say list still apply.
- **Not done:** the server side refusal fallback parameter (a refusal just shows a message), streaming (replies are capped at 12000 tokens and finish in under a minute), and any live run against the real API (no key was available).