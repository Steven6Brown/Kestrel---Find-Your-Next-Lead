# Changelog

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
