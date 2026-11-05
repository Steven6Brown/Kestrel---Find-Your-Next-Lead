# Changelog

## 1.4.1 (branch crm-core)
- Business is closed: mark a lead closed (button on the lead page and on unverified rows, undo with Reopen). Closed businesses leave lead lists, website checks, redesign targets, overview counts and outreach, any unsent draft is rejected, sending is blocked, and a rescan does not reopen them. Find them under Business status, Closed businesses.

## 1.4.0 (branch crm-core)
- Redesign concepts: a scored site gets a concept page (public link, never indexed) that adds a plain "what an automated check noticed" section, dated, with the limits of the check stated. Nothing is copied from their site.
- Redesign email: a separate template that says what was looked at, lists at most three measured findings, links the concept, and keeps the same unsubscribe, address and review rules. Create drafts one at a time or for every site below a cutoff from Redesign targets. Nothing is sent automatically.
- Fixed: headings on every concept page were white on a light background (invisible); the audit's wording is now safe to quote to a business owner, with a test.

## 1.3.0 (branch crm-core)
- Redesign targets page: a free quality check scores each lead's own website out of 100 (HTTPS, phone layout, page structure, image descriptions, current code, speed, contact links, freshness, search and sharing tags) and lists sites below a cutoff you pick (50, 60, 70 or 80) with plain reasons. Optional free PageSpeed key adds Google's measured scores.
- Sites that block automated visitors, do not load, or are built entirely with scripts are not scored. National chains, franchise pages and directory or booking listings are skipped.
- The Leads page now counts how many leads a website check would actually look up.

## 1.2.0 (branch crm-core)
- Free website check: looks each unverified OpenStreetMap lead up in Overture Maps (open data, no account or billing) and moves leads that already have a website out of the no-website list. Social-only pages stay as "Social page only". Leads stay unverified when nothing is found. Leads now store coordinates.

## 1.1.0 (branch crm-core)
- Calendar page with month grid, day panel, scheduling, and an .ics download for Google Calendar. GUIDE.md added.

## 1.0.1 (branch crm-core)
- A connection made before the schema grew now repairs itself (missing table or column triggers a one-time schema update and a retry) instead of showing an error page after a hot reload.
- Recovery tool for scan results left in the old in-project database folder.

## 1.0.0 (branch crm-core)
- PayPal invoicing: create draft, send with confirmation, reconcile payments, outstanding money on Today, Invoices page. Tested against a stand-in PayPal.

## 0.9.0 (branch crm-core)
- Connections page and connector layer (booking link, PayPal test, Resend status, Google Calendar placeholder). Booking link added to outreach drafts and concept pages.

## 0.8.0 (branch crm-core)
- Clients and projects, manual meetings with a Meetings page and Today list, CSV exports of contacts, clients and projects.

## 0.7.0 (branch crm-core)
- CRM core: pipeline stages, append-only timeline, follow-up tasks, a Today screen, a Pipeline board, manual contacts, and stage filtering in the Leads database.

## 0.6.0
- Campaigns now scan every business in the chosen cities (no business types). New filterable Leads database with counts, CSV download, bulk outreach drafts from a filter, and inline website checks. Resumable scans.

## 0.5.0
- Fixed the database being treated as damaged after every unclean stop (stale lock file), which made the app ask to create an account again. Data moves to the app data folder outside OneDrive and existing data is migrated automatically.
- Scan progress shown live, 25 minute limit, early stop after repeated server failures, cut-off scans marked interrupted.

## 0.4.0
- Campaigns picked with buttons only, scheduled through Windows Task Scheduler scripts and a bearer-protected endpoint; run history; retries across Overpass mirrors; verify-before-outreach for OpenStreetMap leads.
- Aquila Digital branding (colors, fonts, logo) across the app.
- Full sign-in system: sessions, logout, password reset, invitations, roles, lockout, two-factor with recovery codes, session management, audit log. Replaces the shared Basic Auth password.

## 0.3.0
- Free OpenStreetMap discovery source (default); Google Places now optional. Source-neutral email and mockup wording, OSM attribution, verify-first warning.

## 0.2.0
- Replaced SQLite with Postgres: `pg` for production (`DATABASE_URL`), PGlite for local dev and tests. Data layer is now async.

## 0.1.0
- Phase 1 discovery with dedupe and no-website / has-website split.
- Phase 2 hosted mockup per no-website lead.
- Phase 3 draft queue, guarded manual send via Resend, signed unsubscribe and suppression list.
- Brand config layer and per-brand data scoping.
