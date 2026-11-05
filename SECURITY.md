# Security

- Secrets only in environment variables; `.env*` is git-ignored; nothing server-side reaches the client.
- Dashboard and server actions behind Basic Auth (`proxy.js`). Fails closed in production without `ADMIN_PASSWORD`.
- Public surface: `/m/<token>` (128 bit token, read only, `noindex`), `/unsubscribe` and `/api/unsubscribe` (HMAC signed, rate limited 20 per minute per IP in memory), legal pages.
- All server action input validated with zod; SQL uses parameterized statements only; React escapes all rendered text; `tel:` links are sanitized.
- Places and Resend responses are treated as untrusted and normalized before storage.
- Security headers and CSP in `next.config.mjs` (CSP keeps `unsafe-inline` for Next.js inline scripts).

## Known issues and limits

- Basic Auth over plain http sends credentials in the clear; use https when deployed.
- The rate limiter is per instance and in memory.
- Basic Auth has no lockout or brute force throttle.
- A double click race on Send is blocked in memory per process only.
- Mockup tokens are unlisted links, not authenticated; anyone with the link can view it.
- No dependency audit beyond `npm audit` at install time.
