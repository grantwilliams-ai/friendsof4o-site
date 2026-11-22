-- The friendsof4o.com form database (D1, bound as DB). Nobody has to run this: lib/forms.js makes both tables
-- itself the first time a form is used. It is here so the shape is written down, and for anyone who prefers to make
-- the tables by hand first (Cloudflare dashboard > Workers & Pages > D1 > friendsof4o-messages > Console).

-- Requests and questions. Unchanged since the first version.
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL);

-- Hourly counters for the limits (added 2026-11-22). Each row is a scrambled code and a count, never an address,
-- and is deleted after the end of its hour.
CREATE TABLE IF NOT EXISTS form_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
