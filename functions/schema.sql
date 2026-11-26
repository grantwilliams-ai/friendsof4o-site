-- The friendsof4o.com form database (D1, bound as DB). Nobody has to run this: lib/forms.js and lib/vote.js make
-- the tables themselves the first time each is used. It is here so the shape is written down, and for anyone who prefers to make
-- the tables by hand first (Cloudflare dashboard > Workers & Pages > D1 > friendsof4o-messages > Console).

-- Requests and questions. Unchanged since the first version.
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL);

-- Hourly counters for the limits (added 2026-11-22). Each row is a scrambled code and a count, never an address.
-- Nothing runs on a clock: a row is deleted by the next API request that reaches the database after its hour ends
-- (any form send, any vote call, any read of the vote's results or download). With no request it stays until one comes.
CREATE TABLE IF NOT EXISTS form_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);

-- The public vote (added 2026-11-24, reshaped 2026-11-25; lib/vote.js makes it on first use, and only once the vote
-- is switched on). One row per vote. sitting is a one-way code made from the set's name and the page's random code;
-- the page's own code is never stored. No address, no browser details, no time of day.
-- pref: yes, maybe, no, or '' when the second question was passed. opened: "Show who wrote this" was pressed for
-- this round. recap: the list of rounds, which names every model, was shown after this vote.
CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, sitting TEXT NOT NULL, round INTEGER NOT NULL, experience TEXT NOT NULL, question TEXT NOT NULL, model TEXT NOT NULL, vote TEXT NOT NULL, pref TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL, opened INTEGER NOT NULL DEFAULT 0, recap INTEGER NOT NULL DEFAULT 0, opened_before INTEGER NOT NULL, is_check INTEGER NOT NULL, flags TEXT NOT NULL, vset TEXT NOT NULL, UNIQUE (vset, sitting, round));

-- The vote has never been switched on, so no votes table exists anywhere and the two new columns (pref, recap)
-- cost nothing. If a votes table in the 2026-11-24 shape is ever found, run these two lines once, by hand, before
-- switching on:
--   ALTER TABLE votes ADD COLUMN pref TEXT NOT NULL DEFAULT '';
--   ALTER TABLE votes ADD COLUMN recap INTEGER NOT NULL DEFAULT 0;
