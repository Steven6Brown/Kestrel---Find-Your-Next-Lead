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

## Connections (performed)
52 unit tests in total. The newest cover booking link validation (including local, numeric and credential-bearing addresses), encrypted secrets and erasure on disconnect, brand isolation, PayPal checks with a stand-in for PayPal (sandbox default, live blocked, 401, network failure, bad reply, no credentials in messages), the connector states, and the booking link appearing in drafts only when saved. In the browser: saved a bad then a good link, ran the PayPal test with no credentials, and confirmed the link appears on a public concept page and on a contact page.

## PayPal invoicing (performed against a stand-in, not real PayPal)
56 unit tests in total. A fake PayPal that behaves like the documented API (sign-in, idempotent create, send, status, expiry, server errors, network failure) is used to test the client (request shapes, headers, amounts as dollar strings, token reuse and refresh, safe errors, unexpected replies rejected), the invoice rules (no overbilling, deposits, balances, status groups, overdue), and the whole flow: draft, send, payment, reconcile, outstanding totals, retries, and brand isolation. In the browser the real screens were run against a local fake PayPal: connection test, create deposit draft (amount computed on the server), refusal to send without the confirmation tick, send, mark paid, Reconcile on Today, timeline entries, Invoices page.

## Calendar (performed)
61 unit tests in total. The newest cover the month grid (including year boundaries, months starting on every weekday, no repeated days), month parameter validation, per-day assembly and ordering, hidden cancelled meetings, scheduled scan days, money only for managers, brand isolation, contact choices, and the .ics export (escaping, folding, UTC, injection attempt, multi-byte characters). In the browser: today highlighted, items in cells, scheduling a meeting from the day panel, the .ics download, month navigation and bad parameter fallback, and the phone layout (no sideways scroll, list view).

## Website verification (performed)
67 unit tests in total. New ones cover name and URL cleaning, conservative matching (same phone, same name nearby, same name in another part of town rejected, city fallback), release lookup and query safety (injection attempts rejected), storing results, a person's confirmed verdict never overridden, rescans not erasing a found website, one lookup per area, the time limit, brand isolation, and the run record with no double start. Against a scratch copy of the real leads database and the live dataset: 274 unverified leads, 108 found with a real website, 23 social page only, 143 not found, no errors. A sample of 25 matches looked right; some are chain store pages or directory listings (for example a salon chain location page), which count as "has a website" but are not always the business's own site. Not clicked through in the browser yet.

## Website quality audit (performed)
77 unit tests in total. New ones cover private address blocking, redirect safety (private hop, loop, oversized page, blocked name), scoring (a good page scores exactly 100, losing the phone layout costs exactly 15, an old page scores low, weights add to 100, empty input does not throw), unreachable and blocked sites never getting a score, script-built pages not being scored, PageSpeed being optional and ignored on bad data, chain and directory listing detection (including local names that must not match), storage, ordering and cutoffs, a won or opted-out lead never listed, brand isolation, runs (progress, one bad site, deadline, no double start). Against the scratch copy of your leads with live websites: 163 sites in about 30 seconds gave 80 scored, 32 chains and 7 directory listings skipped, 27 that would not load, and 17 that blocked robots or are built with scripts; 5 sites scored below 60, 8 below 70, 27 below 80. aquiladigital.net scores 97 (loses only the tap to call link). In the browser (scratch data): the page, cutoff buttons, the check button with live progress and automatic refresh, Recent runs label, and phone width (no sideways scroll, 44 pixel buttons).
Two bugs found by looking at real results and fixed: pages built by scripts were scored as if they had no title, heading or contact link; and a loose rule treated local businesses with two listings, and a single restaurant's ordering page, as chains.

## Redesign concept and email (performed)
82 unit tests in total. New ones cover who qualifies (blocked, chain, unscored, do not contact and no website leads do not), reading the stored findings safely, UTC dates, the email (measured findings only and at most three, the limits of the check, no copying claim, booking line only when saved, unsubscribe, STOP, address, no dash punctuation, refuses leads without a check), a test that every sentence the audit can produce is safe to quote to a business owner, and bulk drafting rules (below cutoff, no existing draft, not skipped, limit, brand isolation). In the browser on scratch data: the concept page with findings, creating one draft and four in bulk, the exact email text, the lead page panels, every send guardrail still blocking, and the concept page at phone width. A bug found there and fixed: headings on every concept page were white on a light background.

## Not performed
- Redesign concept: not sent to a real person; not compared with how business owners react to a findings section; a recipient may find any score unwelcome, so review each draft.
- Quality audit: a real PageSpeed Insights call (no key yet); scores were not compared against a human review of the sites; JavaScript built sites cannot be scored without a browser; only the home page is read.
- Overture Maps license and attribution terms were not confirmed; check them before relying on this or publishing results.
- Importing the .ics file into Google Calendar itself; daylight saving boundaries on the calendar; keyboard and screen reader checks of the calendar.
- Any call to the real PayPal sandbox. The request bodies follow PayPal's documented examples and omit optional fields; PayPal may ask for more (for example invoicer details) when it sees a real request.
- Webhooks, cancelling or refunding invoices, live mode, invoice screens at phone width, keyboard and screen reader checks.
- A real PayPal sandbox call (no credentials yet) and a real Resend send.
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
