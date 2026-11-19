# functions/

Cloudflare Pages Functions for friendsof4o.com. Cloudflare serves `site/` as the pages and runs the files in
this folder beside them: `functions/api/signup.js` answers at `/api/signup`, and so on. `lib/forms.js` (beside
this folder) holds what they share.

Each one answers "not connected" (501) and keeps nothing until its setting exists in the Pages project.

| File | For | Switched on by |
|---|---|---|
| `api/signup.js` | A mailing-list signup. The address goes to the mailing service (Kit) and nowhere else. | `KIT_API_KEY` (secret) and `KIT_FORM_ID` |
| `api/suggestion.js` | "Tell us what you need". Stored in the site's own database. | a D1 database bound as `DB` |
| `api/ask.js` | A question for GPT-4o. Stored in the same database, marked as a question. | the same `DB` |
| `api/pick.js` | One pick in "Does it sound like 4o?". Not written yet: always "not connected". | nothing yet |

What is kept for a request or a question: its kind, the text, the email address if one was given, and the time.
No IP address and no browser details. Signups are never written to the database.
