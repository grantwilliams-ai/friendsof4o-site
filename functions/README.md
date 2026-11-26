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
| `api/vote.js` | One vote in "Which model sounds most like GPT-4o?" (`lib/vote.js`). | the database `DB` AND the setting `VOTE_OPEN` = `yes` |
| `api/vote-pref.js` | The answer to "Would you like a reply like this?" for a saved vote. | the same two |
| `api/vote-opened.js` | Marks that "See which model wrote this" was pressed for a saved vote. | the same two |
| `api/vote-recap.js` | Marks that the list of a sitting's rounds, with every name, was shown. | the same two |
| `api/results.js` | The vote's public counts, for the current set or an earlier one by name. | the same two |
| `api/votes.csv.js` | Every vote from finished UTC days, as a download. | the same two |

What is kept for a request or a question: its kind, the text, the email address if one was given, and the time.
No IP address and no browser details. Signups are never written to the database.

## Limits (since 2026-11-22)

Each form takes at most a few sends an hour from one sender and a ceiling an hour for the whole site
(`LIMITS` in `lib/forms.js`). Past either, it answers 429 with `Retry-After`, and nothing is kept or sent. A sender
is told apart only by a scrambled code made from a random value for that hour and the connection's address; the
address is never written down. The counters and the random value sit in the `form_limits` table with an expiry at
the end of their hour. Nothing runs on a clock: expired rows are deleted by the next API request that reaches the
database after the hour ends (any form send, any vote call, any read of the vote's results or download; `sweep()`
in `lib/forms.js`, since 2026-11-25). On a site in use that is minutes; with no request they stay until the next one.
The pages must say this, not "within the hour". The signup checks its limit before it calls Kit.

The same words with the same address on the same form within a day are kept once.

The tables are made by the code on first use. `schema.sql` has the same statements for the record.

## Tests

The handlers are tested locally with a fake database and a fake Kit (nothing is sent):
`node ../2026-11-22_fo4o-site-review/helpers/forms/test_handlers.mjs .` from the build folder.

## The vote (added 2026-11-24, rebuilt for the first real set 2026-11-25; its pages are on the site, saving is not switched on)

Without both switches every call answers 501, keeps nothing and touches no table.

Calls (all JSON, same-origin only, no cookies):

| Call | Body | Answers |
|---|---|---|
| `POST /api/vote` | `set, sitting, round, experience, question, model, vote, seconds, opened_before, website` | 200 `{ok, vote}`; the same round of the same sitting again: 200 `{ok, vote, again: true}`, the first vote stands, no second row |
| `POST /api/vote-pref` | `set, sitting, round, pref` (`yes`, `maybe`, `no`; a skip sends nothing) | 200 `{ok, pref}`; 404 `not-found` (no such vote); 409 `closed` (already answered differently, or a name was shown for that vote) |
| `POST /api/vote-opened` | `set, sitting, round` | 200 `{ok}`; 404 `not-found` |
| `POST /api/vote-recap` | `set, sitting` | 200 `{ok, votes}` (every saved vote of the sitting marked); 404 `not-found` |
| `GET /api/results[?set=NAME]` | | 200 `{ok, set, current, min_votes, updated, votes, sittings, rows}`; each row is `model, question, experience, vote, pref, first, opened_before, flagged, n` |
| `GET /api/votes.csv` | | finished UTC days, every set: `day,sitting,round,first,experience,question,model,vote,pref,seconds,opened,recap,opened_before,check,flags,set` |

Every call can also answer 400/403/413/415 `bad-request`, 429 `busy` with `Retry-After`, 503 `error` (nothing
kept) or 503 `unconfirmed` (may or may not be kept), with the meanings at the top of `lib/forms.js`.

- The server keeps a vote only for the current set, its messages, the models in rotation and no reply the name
  check left out: `lib/vote-set.js`, written by `python3 -I tools/make_vote_set.py` from `content/vote.json`. Run it
  after changing that file; a build with the vote stops if the two do not fit.
- A sitting with no saved vote is a new sitting, whatever round number the page claims, and is charged to the
  new-sitting limit (12 an hour from one sender). Other limits: 60 an hour from one sender and 3,000 for the site,
  for each of vote, pref, opened and recap.
- `first` is not a column: it is the vote with the lowest id among the saved votes of its sitting, worked out when
  the results or the download are read.
- The page's sitting code is never stored. What is kept is a one-way code made from the set's name and that code.
- No message and no model twice in a sitting; `fast` (under 3 seconds) and `extra` (past round five) are flags, and
  flagged votes are kept.

Tests (nothing is sent anywhere): the real handlers over SQLite in memory (`tools/fake_d1.mjs`, Node's own
`node:sqlite`), `node ../2026-11-24_fo4o-voting-study/tools/test_vote.mjs .` from the build folder (175 of 175 on
2026-11-25). The preview server (`tools/vote_preview_server.mjs`) runs the same handlers. Not tested: Cloudflare's
own local tools (wrangler, D1 itself, the routing of `/api/votes.csv`); they are not installed here.
