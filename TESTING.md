# Testing

## Automated (`npm test`, 10 tests, all passing at last run)
Website classification, Places response normalization and pagination, dedupe on Place ID, bucket split, brand isolation, discovery cost cap, send guardrails (approval, recipient, suppression, cap), opt-out token binding, one-click headers, mockup helpers (no dash punctuation, no lorem, tel sanitizing, contrast choice).

## Manual, performed
- Production build and lint clean.
- Mockup page, auth (401 without credentials, 200 with), 404s for bad tokens and non-no-website leads checked over HTTP.
- Mockup and lead page viewed in the in-app browser; no horizontal scroll at 375px on the lead page.
- Draft creation and the review page with guardrail messages checked in the browser.

## Not performed
- Live Google Places or Resend calls (no keys were available; both are covered only by mocked tests).
- Real phone or tablet testing, tablet landscape, screen reader and keyboard-only passes, automated accessibility scan.
- Sending an actual email and clicking a real unsubscribe link end to end.
- Vercel deployment.
