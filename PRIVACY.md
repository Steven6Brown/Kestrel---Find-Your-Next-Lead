# Privacy and data

| Data | Source | Why | Where | Retention |
|---|---|---|---|---|
| Business name, category, address, city, phone, website, maps link | Google Places API (externally sourced) | Find leads and build concept page | Local SQLite `leads` | Until you delete the database; no delete UI yet |
| Recipient email, notes | Typed by the operator | Send one reviewed email | `leads` | Same |
| Email text and send status | Generated, then edited by the operator | Review and audit trail | `drafts` | Same |
| Opted-out addresses | Unsubscribe link or manual entry | Never contact again | `suppressions` | Kept indefinitely on purpose |

Processors: Google (Places), Resend (delivery), hosting provider. No analytics, no cookies besides HTTP Basic Auth. Data is not used for any other purpose.

Known gap: no per-lead delete or export control yet; delete rows directly in the SQLite file when someone requests removal (keep their address on the suppression list).
