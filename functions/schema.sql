-- The friendsof4o.com form database (D1, bound as DB). Nobody has to run this: lib/forms.js and lib/vote.js make
-- the tables themselves the first time each is used. It is here so the shape is written down, and for anyone who prefers to make
-- the tables by hand first (Cloudflare dashboard > Workers & Pages > D1 > friendsof4o-messages > Console).

-- Requests and questions. Unchanged since the first version.
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL);

-- Counters for the limits (added 2026-11-22; daily ones for the vote added 2026-11-26). Each row is a scrambled
-- code or a plain name, with a count, never an address. Rows for a clock hour end with that hour; rows whose key
-- starts with "day:" are for a UTC day and end at UTC midnight. The random values the codes are made with are
-- rows here too ("salt:" for an hour, "day:salt:" for a day).
-- Nothing runs on a clock: a row is deleted by the next API request that reaches the database after its hour or day
-- ends (any form send, any vote call, any read of the vote's results or download). With no request it stays until one comes.
CREATE TABLE IF NOT EXISTS form_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);

-- The public vote (added 2026-11-24, reshaped 2026-11-25; lib/vote.js makes it on first use, and only once the vote
-- is switched on). One row per vote. sitting is a one-way code made from the set's name and the page's random code;
-- the page's own code is never stored. No address, no browser details, no time of day.
-- pref: yes, maybe, no, or '' when the second question was passed. opened: "Show who wrote this" was pressed for
-- this round. recap: the list of rounds, which names every model, was shown after this vote.
CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, sitting TEXT NOT NULL, round INTEGER NOT NULL, experience TEXT NOT NULL, question TEXT NOT NULL, model TEXT NOT NULL, vote TEXT NOT NULL, pref TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL, opened INTEGER NOT NULL DEFAULT 0, recap INTEGER NOT NULL DEFAULT 0, opened_before INTEGER NOT NULL, is_check INTEGER NOT NULL, flags TEXT NOT NULL, vset TEXT NOT NULL, UNIQUE (vset, sitting, round));

-- Kept copies for the vote's two public reads (added 2026-11-26; lib/vote.js makes it on first use, with the votes
-- table), so that a read costs a few rows and not the whole votes table. Nothing in it is new information: every
-- row is made from the votes table and can be made again.
--   key "csv", part 0          body: the last finished UTC day the kept lines cover. mark: goes up each time a vote
--                              of a finished day changes.
--   key "csv:DAY", parts 0..   that day's lines of the download, in parts of at most 250,000 characters. Part 0 is
--                              written last, and its mark is the number of parts.
--   key "results:SET", parts   that set's counts as JSON, in parts. On part 0, made is when it was last counted
--                              (milliseconds) and mark goes up with each change to a vote the results count.
-- If votes are ever changed or deleted by hand, run this too, so the copies are made again:  DELETE FROM vote_kept;
CREATE TABLE IF NOT EXISTS vote_kept (key TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, made INTEGER NOT NULL, mark INTEGER NOT NULL, PRIMARY KEY (key, part));

-- The vote has never been switched on, so no votes table exists anywhere and the two new columns (pref, recap)
-- cost nothing. If a votes table in the 2026-11-24 shape is ever found, run these two lines once, by hand, before
-- switching on:
--   ALTER TABLE votes ADD COLUMN pref TEXT NOT NULL DEFAULT '';
--   ALTER TABLE votes ADD COLUMN recap INTEGER NOT NULL DEFAULT 0;
