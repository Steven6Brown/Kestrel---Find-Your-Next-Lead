# Changelog

## 0.3.0
- Free OpenStreetMap discovery source (default); Google Places now optional. Source-neutral email and mockup wording, OSM attribution, verify-first warning.

## 0.2.0
- Replaced SQLite with Postgres: `pg` for production (`DATABASE_URL`), PGlite for local dev and tests. Data layer is now async.

## 0.1.0
- Phase 1 discovery with dedupe and no-website / has-website split.
- Phase 2 hosted mockup per no-website lead.
- Phase 3 draft queue, guarded manual send via Resend, signed unsubscribe and suppression list.
- Brand config layer and per-brand data scoping.
