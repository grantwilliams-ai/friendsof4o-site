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
| `api/results.js` | The vote's public counts from finished UTC days, for the current set or an earlier one by name. | the same two |
| `api/votes.csv.js` | Every vote from finished UTC days, as a download. | the same two |

What is kept for a request or a question: its kind, the text, the email address if one was given, and the time.
No IP address and no browser details. Signups are never written to the database.

## Limits (since 2026-11-22; senders by block, refused sends that write nothing, and daily limits for the vote since 2026-11-26)

Each form takes at most a few sends an hour from one sender and a ceiling an hour for the whole site. The vote
has daily limits as well (see "The vote" below). Every number is in one place, `LIMITS` in `lib/forms.js`, named
by what it counts: `sender_hour`, `site_hour`, `sender_day`, `site_day`. Past any of them a call answers 429 with
`Retry-After` (the rest of the hour, or the rest of the UTC day when a daily limit is the full one), and nothing is
kept or sent.

Who a sender is: an IPv4 address counts as itself. An IPv6 address counts by its /64 block (its first four
groups), so one home or one rented block is one sender. An IPv4 address written inside IPv6 (`::ffff:a.b.c.d`)
counts as that IPv4 address. Anything that cannot be read counts as the text it is.

A sender is told apart only by a scrambled code made from a random value and the sender; the address is never
written down. There is one random value for each clock hour and one for each UTC day. The counters and the random
values sit in the `form_limits` table, each with an expiry at the end of its hour or its day (rows for a day have
keys that start with `day:`).

A refused send writes nothing. The counters are read first; a send that finds one at its limit is answered there,
so a loop of refused sends costs reads only, and a refused sender does not use up the site's count. A send under
its limits adds one to all of its counters in one statement, which changes nothing if any of them has filled up
meanwhile, so sends that arrive together cannot slip past.

Nothing runs on a clock: expired rows are deleted by the next API request that reaches the database after their
hour or day ends (any form send, any vote call, any read of the vote's results or download; `sweep()` in
`lib/forms.js`, since 2026-11-25). On a site in use that is minutes; with no request they stay until the next one.
The pages must say this, not "within the hour". The signup checks its limit before it calls Kit.

The same words with the same address on the same form within a day are kept once.

The tables are made by the code on first use. `schema.sql` has the same statements for the record.

## Tests

The handlers are tested locally with a fake database and a fake Kit (nothing is sent):
`node ../2026-11-22_fo4o-site-review/helpers/forms/test_handlers.mjs .` from the build folder (48 of 48 on
2026-11-26).

## The vote (added 2026-11-24, rebuilt for the first real set 2026-11-25; its pages are on the site, saving is not switched on)

Without both switches every call answers 501, keeps nothing and touches no table.

Calls (all JSON, same-origin only, no cookies):

| Call | Body | Answers |
|---|---|---|
| `POST /api/vote` | `set, sitting, round, experience, question, model, vote, seconds, opened_before, website` | 200 `{ok, vote}`; the same round of the same sitting again: 200 `{ok, vote, again: true}`, the first vote stands, no second row |
| `POST /api/vote-pref` | `set, sitting, round, pref` (`yes`, `maybe`, `no`; a skip sends nothing) | 200 `{ok, pref}`; 404 `not-found` (no such vote); 409 `closed` (already answered differently, or a name was shown for that vote) |
| `POST /api/vote-opened` | `set, sitting, round` | 200 `{ok}`; 404 `not-found` |
| `POST /api/vote-recap` | `set, sitting` | 200 `{ok, votes}` (every saved vote of the sitting marked); 404 `not-found` |
| `GET /api/results[?set=NAME]` | | 200 `{ok, set, current, min_votes, updated, through, votes, sittings, rows}`; each row is `model, question, experience, vote, pref, first, opened_before, flagged, n`; `through` is the last UTC day counted (`YYYY-MM-DD`, the day before today); `votes`, `sittings` and the rows count finished days only; `updated` is when the counts were made |
| `GET /api/votes.csv` | | finished UTC days, every set: `day,sitting,round,first,experience,question,model,vote,pref,seconds,opened,recap,opened_before,check,flags,set` |

Every call can also answer 400/403/413/415 `bad-request`, 429 `busy` with `Retry-After`, 503 `error` (nothing
kept) or 503 `unconfirmed` (may or may not be kept), with the meanings at the top of `lib/forms.js`.

- The server keeps a vote only for the current set, its messages, the models in rotation and no reply the name
  check left out: `lib/vote-set.js`, written by `python3 -I tools/make_vote_set.py` from `content/vote.json`. Run it
  after changing that file; a build with the vote stops if the two do not fit.
- A sitting with no saved vote is a new sitting, whatever round number the page claims, and is charged to the
  new-sitting limits as well as the vote's. A call is counted against all of its limits at once, or against none.
- The vote's limits (`LIMITS` in `lib/forms.js`):

  | What | One sender | The whole site |
  |---|---|---|
  | New sittings | 12 an hour and 30 a UTC day | 150 an hour and 450 a UTC day |
  | `vote` calls | 60 an hour | 1,500 an hour |
  | `vote-pref` calls | 60 an hour | 1,500 an hour |
  | `vote-opened` calls | 60 an hour | 1,500 an hour |
  | `vote-recap` calls | 60 an hour | 500 an hour |
  | All four kinds of call together | | 4,500 a UTC day |

  A vote sent again for a round already kept counts as a call. The two reads take no limit, because a limit would
  have to write.
- A follow-up sent again for a vote it has already changed (the same answer, "opened" twice, the recap twice)
  answers 200 as before and changes no row but its counters.
- `first` is not a column: it is the vote with the lowest id among the saved votes of its sitting, worked out when
  the results or the download are counted.
- The page's sitting code is never stored. What is kept is a one-way code made from the set's name and that code.
- No message and no model twice in a sitting; `fast` (under 3 seconds) and `extra` (past round five) are flags, and
  flagged votes are kept.

### Kept copies for the two reads (since 2026-11-26)

`/api/results` and `/api/votes.csv` are open to anyone, so a loop of reads must stay cheap. Both are served from
copies kept in the table `vote_kept`, and a repeat read is two statements and a few rows, with nothing written.
The Cloudflare cache is not used.

- The download. Each finished UTC day's lines are made once, in the file's own order, and kept in parts of at
  most 250,000 characters. A read puts the kept parts together. The first read after a day ends reads the votes
  table once for the days not kept yet. The file is, to the letter, what one query over the whole table gave
  before.
- A follow-up that lands after midnight for a vote cast before it changes a finished day. In the same step as the
  change, that day's kept lines are dropped; the next read makes them again. The step also moves a change number,
  so a read that was making the lines at that moment keeps nothing. A day counts as finishing from five minutes
  before its end, so nothing near midnight is missed.
- The results count finished UTC days only, like the download (since 2026-11-26): a vote shows in them the day
  after it is saved. One rule, `RESULTS_RULE` in `lib/vote.js`, says which days are counted: `through` is the day
  before today. The reply names that day as `through`.
- The counts for a set are kept as one JSON text, cut into parts if it is long. A read counts again when the day
  has changed since the copy was made. A vote saved today moves nothing in the copy (but in the last five minutes
  of a day it does, as that day is about to be counted). A follow-up that lands after midnight for a vote of a
  finished day (an answer to the second question) moves a change number on the copy; a read then counts again, at
  most once an hour for each set (`wait` in the same rule, 3600 seconds), so such an answer can take up to an hour
  to show. When several reads arrive together, one of them counts. `updated` in the reply is when the counts were
  made. Otherwise there is no new count, however many reads arrive.
- The current set's copy is kept even when it counts no votes, so on the first day (votes saved, none from a
  finished day yet) a loop of reads does not count again each time. Any other set name with no votes keeps
  nothing, so made-up `?set=` names write nothing.
- If votes are ever changed or deleted by hand in the database, run `DELETE FROM vote_kept;` as well. The copies
  are then made again from the votes table.

Tests (nothing is sent anywhere): the real handlers over SQLite in memory (`tools/fake_d1.mjs`, Node's own
`node:sqlite`), `node ../2026-11-24_fo4o-voting-study/tools/test_vote.mjs .` from the build folder (329 of 329 on
2026-11-26). The preview server (`tools/vote_preview_server.mjs`) runs the same handlers. Not tested: Cloudflare's
own local tools (wrangler, D1 itself, the routing of `/api/votes.csv`); they are not installed here. The statements
added on 2026-11-26 are plain SQLite, but none of them has run on D1 itself.

### The test on a Cloudflare preview (tools added 2026-11-26; not yet run against Cloudflare)

A branch named `vote-test` of the site's repository is built by Cloudflare Pages as a preview, apart from the live
site, at `https://vote-test.friendsof4o-site.pages.dev`. The project's Preview settings must bind a separate test
database as `DB` and have `VOTE_OPEN` = `yes`. Three tools, in order:

1. `python3 -I tools/make_vote_test_branch.py OUT` makes the folder to push: the whole site with saving on, this
   folder and `lib/`, searched for notes and machine paths as a release is.
2. `bash tools/push_vote_test_branch.sh OUT` is the site owner's own step. It pushes the one branch `vote-test` and prints the
   command that deletes it later.
3. `node tools/live_vote_test.mjs https://vote-test.friendsof4o-site.pages.dev --state FILE` sends real requests to
   the preview: the two reads, one whole sitting, the wrong cases above, and new sittings until the limit refuses
   the 13th. It saves test votes in the test database and uses up that connection's hour. The day after, the same
   command with `--next-day` checks that the results and the download now hold them. It refuses any address that
   is not a preview of the Pages project, so it cannot be pointed at the live site.
