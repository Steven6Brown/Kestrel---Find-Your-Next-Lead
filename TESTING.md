# Testing

## Automated (`npm test`, 24 tests, all passing at last run, run against PGlite, a real Postgres engine)
Website classification, Places response normalization and pagination, dedupe on Place ID, bucket split, brand isolation, discovery cost cap, send guardrails (approval, recipient, suppression, cap), opt-out token binding, one-click headers, mockup helpers (no dash punctuation, no lorem, tel sanitizing, contrast choice).

## Manual, performed
- Production build and lint clean.
- Mockup page, auth (401 without credentials, 200 with), 404s for bad tokens and non-no-website leads checked over HTTP.
- Mockup and lead page viewed in the in-app browser; no horizontal scroll at 375px on the lead page.
- Draft creation and the review page with guardrail messages checked in the browser.

## Manual, auth (performed in the in-app browser against a dev server)
First-run setup, wrong password message with email kept, two-factor enrollment (QR and key shown), sign in with a wrong then right code, forgot password (identical answer for known and unknown emails, one email in the outbox), reset with weak, common and mismatched passwords then success, reused link rejected, signed-out and forged-cookie requests redirected.

## CRM core (performed)
Unit tests (42 in total) cover stages and the status sync, manual contacts without a place id, the append-only timeline, not-interested and unsubscribe suppression, send moving a contact to contacted, task groups for Today, snooze and completion, the pipeline membership rule, brand isolation, and re-opening an existing database with the new schema. In the browser: added a contact, set a stage, added a follow-up, viewed Today and Pipeline against a database that had the older schema.

## Clients, projects, meetings, exports (performed)
47 unit tests in total. The newest cover money and time parsing, converting a contact once, project totals that skip cancelled work, meeting ownership and stage moves, brand isolation, database constraints, and export contents. In the browser: logged a meeting (stage moved by itself), converted a contact to a client, added a project with a quoted amount, and downloaded all three CSVs.

## Not performed
- Clients, projects and meetings screens at phone width; keyboard-only and screen reader checks.
- Daylight saving boundaries for meeting times (the conversion helper is tested only for local-time reading).
- CRM screens at phone width, keyboard-only and screen reader checks, concurrent edits.
- Lockout, invitation, user management and session revoke screens were covered by unit tests only, not clicked through.
- Recovery code display after enrollment was fixed after a bug was found; the fix was not re-run in the browser.
- Real email delivery of reset and invite links; authenticator app scanning of the QR code (the same key was used to compute codes instead).
- Connecting to a real Neon / Vercel Postgres instance through `pg` (only the PGlite path was exercised).
- Live OpenStreetMap (Nominatim / Overpass) calls, live Google Places or Resend calls (no keys were available; both are covered only by mocked tests).
- Real phone or tablet testing, tablet landscape, screen reader and keyboard-only passes, automated accessibility scan.
- Sending an actual email and clicking a real unsubscribe link end to end.
- Vercel deployment.
