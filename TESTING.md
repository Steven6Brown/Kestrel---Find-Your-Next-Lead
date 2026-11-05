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

## Not performed
- Lockout, invitation, user management and session revoke screens were covered by unit tests only, not clicked through.
- Recovery code display after enrollment was fixed after a bug was found; the fix was not re-run in the browser.
- Real email delivery of reset and invite links; authenticator app scanning of the QR code (the same key was used to compute codes instead).
- Connecting to a real Neon / Vercel Postgres instance through `pg` (only the PGlite path was exercised).
- Live OpenStreetMap (Nominatim / Overpass) calls, live Google Places or Resend calls (no keys were available; both are covered only by mocked tests).
- Real phone or tablet testing, tablet landscape, screen reader and keyboard-only passes, automated accessibility scan.
- Sending an actual email and clicking a real unsubscribe link end to end.
- Vercel deployment.
