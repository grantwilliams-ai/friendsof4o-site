# functions/

Cloudflare Pages Functions for friendsof4o.com. Cloudflare serves `site/` as the pages and runs the files in
this folder beside them: `functions/api/signup.js` answers at `/api/signup`, and so on. `lib/forms.js` (beside
this folder) holds what they share.

Each one answers "not connected" (501) and keeps nothing until its setting exists in the Pages project.

| File | For | Switched on by |
|---|---|---|
| `api/signup.js` | A mailing-list signup. The address goes to the mailing service (Kit) and nowhere else. | `KIT_API_KEY` (secret), `KIT_FORM_ID`, and the database `DB` (for the hourly limits only) |
| `api/suggestion.js` | "Tell us what you need". Stored in the site's own database. | a D1 database bound as `DB` |
| `api/ask.js` | A question for GPT-4o. Stored in the same database, marked as a question. | the same `DB` |
| `api/pick.js` | One pick in "Does it sound like 4o?". Not written yet: always "not connected". | nothing yet |

What is kept for a request or a question: its kind, the text, the email address if one was given, and the time.
No IP address and no browser details. Signups are never written to the database.

## Limits (since 2026-11-22)

Each form takes at most a few sends an hour from one sender and a ceiling an hour for the whole site
(`LIMITS` in `lib/forms.js`). Past either, it answers 429 with `Retry-After`, and nothing is kept or sent. A sender
is told apart only by a scrambled code made from a random value for that hour and the connection's address; the
address is never written down. Every counter and every random value is deleted after its hour (`form_limits` table).
The signup checks its limit before it calls Kit.

The same words with the same address on the same form within a day are kept once.

Both tables are made by the code on first use. `schema.sql` has the same statements for the record.

## Tests

The handlers are tested locally with a fake database and a fake Kit (nothing is sent):
`node ../2026-11-22_fo4o-site-review/helpers/forms/test_handlers.mjs .` from the build folder.
