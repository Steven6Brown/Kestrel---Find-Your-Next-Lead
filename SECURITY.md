# Security

## Sign-in and accounts

| Control | How it works |
|---|---|
| First run | `/setup` creates the owner account once. On localhost it needs nothing; any other host needs `SETUP_TOKEN`. After the first user exists the page redirects away. |
| Passwords | scrypt (N=32768, r=8), unique salt, constant-time compare. Policy follows NIST 800-63B: 12 to 128 characters, common password and name/email blocklist, plus a breached-password check against Have I Been Pwned (only a 5 character hash prefix is sent; fails open if offline; disable with `AUTH_CHECK_BREACHED=0`). |
| Sessions | 256 bit random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` on https). Only a SHA-256 hash is stored. New token on every sign-in and after the second factor. Idle timeout 8 h and absolute 12 h (14 d / 30 d with "keep me signed in"). Disabled users lose access immediately. |
| Brute force | 5 failed attempts lock the account for 15 minutes (owner emailed if mail is set up), plus a per-IP limit of 10 attempts a minute. Responses for unknown email and wrong password are identical and cost the same time. |
| Two-factor | TOTP (RFC 6238, checked against the official test vector). Secrets are encrypted at rest (AES-256-GCM). A used code cannot be replayed. 10 single-use recovery codes, stored only as hashes. `REQUIRE_MFA=1` makes it mandatory. |
| Password reset | One-time link, 1 hour, hashed in the database, a newer link voids older ones, consumed atomically. Request page gives the same answer whether or not the email exists. Success signs the user out everywhere and sends a notice. The reset page sends no Referer. |
| Invitations | Owner or administrator invites by email; 7 day single-use link. Roles: owner, administrator, member. At least one owner is always kept. Administrators cannot change owners. |
| Account page | Change password (needs current one), see and revoke sessions, manage two-factor, see recent security events. |
| Audit log | Sign-ins, failures, lockouts, resets, password and two-factor changes, invitations, role and status changes. Owners and administrators can read it. |
| Enforcement | `proxy.js` redirects signed-out visitors; every page and every server action re-checks the session in the database (`requireUser`). Sending email needs owner or administrator. Server actions also get Next.js origin checks (CSRF). |

## CRM

- Every CRM read and write is scoped by `brand_id` in the store layer, and a test confirms another brand cannot read, change, or complete a contact's timeline, tasks, or stage.
- Server actions validate with zod and allowlists (stage, source, activity kind, quick due dates); free text is length limited and rendered escaped.
- The timeline is append only: there is no edit or delete path.
- Marking someone not interested suppresses their address and rejects pending drafts.
- Clients, projects and meetings are brand scoped the same way (inserted with a SELECT from the owning row, so a record cannot be attached to another brand's contact or client), with database CHECK constraints on types, statuses and meeting places. Money is stored as integer cents and parsed from a strict pattern. CSV exports use an allowlist of kinds, require a signed-in session, and neutralize spreadsheet formula injection.

## Other controls

- Secrets only in environment variables; `.env*` and `data/` are git-ignored.
- Public surface: `/m/<token>` (128 bit token, read only, `noindex`), unsubscribe (HMAC signed, rate limited), legal pages, sign-in and recovery pages, and `/api/cron/run` (bearer `CRON_SECRET`, rate limited).
- All server action input is validated (zod or explicit allowlists); SQL is parameterized; React escapes output; post-login redirects are same-site only.
- Security headers and CSP in `next.config.mjs` (CSP keeps `unsafe-inline` for Next.js inline scripts). Account pages are `no-store`.

## Known limits (not done)

- No single sign-on (SAML or OIDC), no passkeys or hardware keys, no per-user email change flow, no IP allowlisting.
- Account lockout can be triggered by anyone who knows an email (a standard trade-off; the owner can unlock under Users).
- Rate limiters are in memory and per instance. Behind several servers, use a shared store.
- Local use writes reset and invite emails to `data/outbox.log` when email is not configured. Treat that file as sensitive; it is never used on Vercel.
- On plain http the session cookie is not `Secure`. Use https when hosted.
- Not independently penetration tested.
