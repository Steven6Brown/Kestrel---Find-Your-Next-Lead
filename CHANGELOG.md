# Changelog

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
