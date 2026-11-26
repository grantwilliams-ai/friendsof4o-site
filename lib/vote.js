// The public vote on which models sound like GPT-4o. Shared by functions/api/vote.js, vote-pref.js,
// vote-opened.js, vote-recap.js, results.js and votes.csv.js. Not a route itself.
//
// Two switches, both needed: the database (binding DB) and the setting VOTE_OPEN = "yes". Without both, every
// call answers 501 "not-connected", keeps nothing and touches no table.
//
// Kept with a vote (one row; the columns of the public download are the same, see COLUMNS below):
//   day            the UTC day. No time of day.
//   sitting        a one-way code made from the set's name and the page's random sitting code. The page's own code
//                  is never stored, so a published row cannot be used to add to or change a sitting, and the same
//                  sitting code under another set gives another published code.
//   round          the round's number in the sitting, as the page counted it
//   experience     never | casual | power | skip
//   question, model
//   vote           very | some | no | unsure
//   pref           yes | maybe | no, or '' when "Would you like a reply like this?" was passed (POST /api/vote-pref)
//   seconds        whole seconds from showing the replies to the tap
//   opened         1 once "Show who wrote this" was pressed for this round (POST /api/vote-opened)
//   recap          1 once the list of rounds, which names every model, was shown after this vote (POST /api/vote-recap)
//   opened_before  1 when the page says a name had been shown earlier (in this sitting, or in an earlier sitting on
//                  the same page, which is how a sitting begun with "Start again" arrives)
//   is_check       1 when the unnamed reply was the GPT-4o check
//   flags          "fast" (under 3 seconds), "extra" (past the last round of a sitting)
//   vset           the set's name
// No address, no browser details, no name, no email address.
//
// "first" is not a column. It is worked out when the results or the download are counted: the vote with the lowest
// id among the saved votes of its sitting, which is the first vote the server saved for that sitting. It is not
// "round 1": a sitting whose first vote failed to save has its first saved vote in round 2.
//
// Limits (the numbers are LIMITS in lib/forms.js; a refused call writes nothing):
//   each of vote, pref, opened and recap: so many an hour from one sender, so many an hour for the whole site
//   all four together: so many a UTC day for the whole site
//   new sittings: so many an hour and so many a UTC day from one sender, and the same two for the whole site
// A call is counted against all of its limits at once, or against none.
//
// Kept copies (table vote_kept), so that reading the results or the download again and again costs a few rows
// and not the whole votes table:
//   the download   each finished UTC day's lines are made once and kept, in parts. A read puts the kept parts
//                  together. A change to a vote of a finished day (a follow-up that lands after midnight) drops that
//                  day's kept lines in the same step, and the next read makes them again.
//   the results    count finished UTC days only, like the download (decided 2026-11-26): today's votes are counted
//                  tomorrow. The counts for a set are kept and served from the copy. A read counts again once
//                  after each day ends, and after a change to a vote of a finished day (which moves a number on
//                  the copy), at most once an hour for each set. RESULTS_RULE below is the one rule for which
//                  days are counted. The current set's copy is kept even while it counts no votes, so on the first
//                  day a read does not count again each time.
// The reads take no sender limit, because a limit would have to write.
// If votes are ever changed or deleted by hand in the database, empty the kept copies too: DELETE FROM vote_kept.
import { reply, notConnected, badRequest, failed, unconfirmed, readBody, isRobot, checkLimit, ensureTables, sweep } from './forms.js';
import { VOTE_SET } from './vote-set.js';

const VOTES = 'CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, ' +
  'sitting TEXT NOT NULL, round INTEGER NOT NULL, experience TEXT NOT NULL, question TEXT NOT NULL, ' +
  "model TEXT NOT NULL, vote TEXT NOT NULL, pref TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL, " +
  'opened INTEGER NOT NULL DEFAULT 0, recap INTEGER NOT NULL DEFAULT 0, opened_before INTEGER NOT NULL, ' +
  'is_check INTEGER NOT NULL, flags TEXT NOT NULL, vset TEXT NOT NULL, UNIQUE (vset, sitting, round))';
// Kept copies. key is "csv" (one row: body is the last finished day the kept lines cover, mark goes up each time a
// vote of a finished day changes), "csv:DAY" (that day's lines, in parts; part 0 is written last and its mark is
// the number of parts) or "results:SET" (that set's counts as JSON, in parts; on part 0, made is when it was last
// counted, in milliseconds, and mark goes up with each change to a vote the results count).
const KEPT = 'CREATE TABLE IF NOT EXISTS vote_kept (key TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, ' +
  'made INTEGER NOT NULL, mark INTEGER NOT NULL, PRIMARY KEY (key, part))';
const ready = new WeakSet();
async function ensureVotes(db) {
  await ensureTables(db);                      // the limits table
  if (ready.has(db)) { return; }
  await db.batch([db.prepare(VOTES), db.prepare(KEPT)]);
  ready.add(db);
}

const open = (env) => Boolean(env.DB) && env.VOTE_OPEN === 'yes';
const EXPERIENCE = ['never', 'casual', 'power', 'skip'];
const CHOICES = ['very', 'some', 'no', 'unsure'];
const PREFS = ['yes', 'maybe', 'no'];
const SITTING = /^[A-Za-z0-9_-]{22,40}$/;
const SET_NAME = /^[a-z0-9-]{1,40}$/;
const FAST_SECONDS = 3;                        // a tap sooner than this is kept and flagged "fast"
const MAX_ROUND = 200;                         // far past any real sitting; rounds past VOTE_SET.rounds_max are flagged "extra"
const FIRST = '(id = (SELECT MIN(f.id) FROM votes f WHERE f.vset = votes.vset AND f.sitting = votes.sitting))';
const CALLS = 'vote_calls';                    // the limit that counts vote, pref, opened and recap together
export const PART_CHARS = 250000;              // the most text in one kept row: well under 1 MB, whatever the characters
const SOON_MS = 5 * 60 * 1000;                 // a day counts as finishing from five minutes before its end (see touch)

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayBefore = (day) => dayOf(Date.parse(day + 'T00:00:00Z') - 86400000);

// The one rule for the kept results.
//   through   the last day a copy counts, given today's date. The rule since 2026-11-26: the day before today, so
//             the results count finished UTC days only. (To count votes as they arrive it would be
//             (today) => today; nothing else would have to change.)
//   wait      the least seconds between two counts of the same set
// A kept copy is stale when it was counted through another day, or when a vote it counts has changed since and
// the wait is over (stale() below).
export const RESULTS_RULE = { through: (today) => dayBefore(today), wait: 3600 };
const stale = (copy, head, now, through) => copy.through !== through ||
  (copy.seen !== head.mark && now - head.made >= RESULTS_RULE.wait * 1000);

// Statements to run in the same step (one batch) as any change to a saved vote of this day, so the kept copies can
// never be left out of date:
//   the results  the set's change number goes up, when the day is one the results count.
//   the download a vote of a finished day: that day's kept lines go, the mark of "covered through" moves back to
//                the day before, and its change number goes up, which also stops a read that is building right now
//                from keeping lines it counted before this change. "Finished" starts five minutes early, so a
//                change that lands just after midnight, or beside a read just after midnight, is never missed.
// On an ordinary vote, well inside its own day, this is nothing at all: the results do not count today, and the
// download does not hold it.
function touch(db, day, now, inResults) {
  const soon = dayOf(now + SOON_MS);
  const out = [];
  if (inResults && day <= RESULTS_RULE.through(soon)) {
    out.push(db.prepare("INSERT INTO vote_kept (key, part, body, made, mark) VALUES (?, 0, '', 0, 1) " +
      'ON CONFLICT(key, part) DO UPDATE SET mark = vote_kept.mark + 1').bind('results:' + VOTE_SET.set));
  }
  if (day < soon) {
    out.push(db.prepare('DELETE FROM vote_kept WHERE key = ?').bind('csv:' + day));
    out.push(db.prepare("INSERT INTO vote_kept (key, part, body, made, mark) VALUES ('csv', 0, '', 0, 1) " +
      'ON CONFLICT(key, part) DO UPDATE SET body = MIN(vote_kept.body, ?), mark = vote_kept.mark + 1').bind(dayBefore(day)));
  }
  return out;
}

// The one-way code kept in place of the page's sitting code. The set's name is part of it.
export async function publicSitting(set, sitting) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${set}|${sitting}`));
  return Array.from(new Uint8Array(digest).slice(0, 10), (x) => x.toString(16).padStart(2, '0')).join('');
}

const whole = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const notFound = () => reply({ ok: false, reason: 'not-found' }, 404);
const mine = (b) => b.set === VOTE_SET.set && typeof b.sitting === 'string' && SITTING.test(b.sitting);

// POST /api/vote : { set, sitting, round, experience, question, model, vote, seconds, opened_before, website }
// 200 { ok: true, vote } when the vote is kept; the same, with again: true, when this round of this sitting was
// kept before (a double tap, a retry): the first vote stands and no second row is made.
export async function storeVote(context) {
  const { request, env } = context;
  if (!open(env)) { return notConnected(); }
  await sweep(env.DB);
  const { body, reply: refused } = await readBody(request);
  if (refused) { return refused; }
  const robot = isRobot(body);
  if (robot === null) { return badRequest(); }
  if (robot) { return reply({ ok: true }); }                                   // keep nothing
  const b = body;
  // Only the current set, its messages, the models in rotation, and no reply the name check left out.
  if (!mine(b) || !whole(b.round, 1, MAX_ROUND) || !EXPERIENCE.includes(b.experience) || !CHOICES.includes(b.vote) ||
      !VOTE_SET.questions.includes(b.question) || !VOTE_SET.models.includes(b.model) ||
      (VOTE_SET.left_out[b.model] || []).includes(b.question) ||
      typeof b.seconds !== 'number' || !Number.isFinite(b.seconds) || b.seconds < 0 || b.seconds > 86400 ||
      typeof b.opened_before !== 'boolean') {
    return badRequest();
  }
  const same = (row) => row.question === b.question && row.model === b.model;
  const again = (row) => reply({ ok: true, vote: row.vote, again: true });
  let sid;
  try {
    await ensureVotes(env.DB);
    sid = await publicSitting(VOTE_SET.set, b.sitting);
    const saved = (await env.DB.prepare('SELECT round, question, model, vote FROM votes WHERE vset = ? AND sitting = ?')
      .bind(VOTE_SET.set, sid).all()).results;
    // A sitting with no saved vote is a new sitting, whatever round number the page claims, and new sittings
    // have their own, lower limits. All of this call's limits are checked and counted in one step, so a vote that
    // is refused as a new sitting is not counted as a vote either, and two new sittings arriving together cannot
    // both take the last place. Two requests for the same new sitting arriving together are both charged: the
    // limit can be stricter than it says for a moment, never looser.
    const busy = await checkLimit(request, env.DB, saved.length ? ['vote', CALLS] : ['vote', 'sitting', CALLS]);
    if (busy) { return busy; }
    const before = saved.find((row) => row.round === b.round);
    if (before) { return same(before) ? again(before) : badRequest(); }       // this round is already kept
    if (saved.some(same) || saved.some((row) => row.question === b.question || row.model === b.model)) {
      return badRequest();                                                     // no message and no model twice in a sitting
    }
  } catch (e) {
    return failed();                                                           // nothing was kept
  }
  const flags = [];
  if (b.seconds < FAST_SECONDS) { flags.push('fast'); }
  if (b.round > VOTE_SET.rounds_max) { flags.push('extra'); }
  try {
    // One statement decides: the row goes in only if this round is not kept yet and neither the message nor the
    // model is in the sitting already, so two requests arriving together cannot both get in. The kept copies are
    // told in the same step (touch).
    const now = Date.now();
    const day = dayOf(now);
    const [kept] = await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO votes (day, sitting, round, experience, question, model, ' +
      'vote, seconds, opened_before, is_check, flags, vset) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS ' +
      '(SELECT 1 FROM votes WHERE vset = ? AND sitting = ? AND (question = ? OR model = ?)) RETURNING id')
      .bind(day, sid, b.round, b.experience, b.question, b.model, b.vote,
        Math.floor(b.seconds), b.opened_before ? 1 : 0, b.model === VOTE_SET.check ? 1 : 0, flags.join(' '),
        VOTE_SET.set, VOTE_SET.set, sid, b.question, b.model), ...touch(env.DB, day, now, true)]);
    if (!kept.results.length) {                                                // another request got there first
      const now = await env.DB.prepare('SELECT question, model, vote FROM votes WHERE vset = ? AND sitting = ? AND round = ?')
        .bind(VOTE_SET.set, sid, b.round).first();
      return now && same(now) ? again(now) : badRequest();
    }
  } catch (e) {
    return unconfirmed();                                                      // it may or may not have been kept
  }
  return reply({ ok: true, vote: b.vote });
}

// The three calls that change a saved vote share their start. Returns { body, sid } or { reply }.
async function saved(context, kind, valid) {
  const { request, env } = context;
  if (!open(env)) { return { reply: notConnected() }; }
  await sweep(env.DB);
  const { body, reply: refused } = await readBody(request);
  if (refused) { return { reply: refused }; }
  if (!mine(body) || !valid(body)) { return { reply: badRequest() }; }
  try {
    await ensureVotes(env.DB);
    const busy = await checkLimit(request, env.DB, [kind, CALLS]);
    if (busy) { return { reply: busy }; }
  } catch (e) {
    return { reply: failed() };
  }
  return { body, env, sid: await publicSitting(VOTE_SET.set, body.sitting) };
}

// POST /api/vote-pref : { set, sitting, round, pref } : the answer to "Would you like a reply like this?" for a
// round already voted on. A pass sends nothing, so the row keeps ''. The answer is taken once, and only while no
// name has been shown for that vote: after "Show who wrote this" or the list of rounds it answers 409 "closed".
// The same answer sent again is 200 (a retry), and writes nothing.
export async function storePref(context) {
  const got = await saved(context, 'pref', (b) => whole(b.round, 1, MAX_ROUND) && PREFS.includes(b.pref));
  if (got.reply) { return got.reply; }
  const { body, env, sid } = got;
  try {
    const look = env.DB.prepare('SELECT day, pref, opened, recap FROM votes WHERE vset = ? AND sitting = ? AND round = ?')
      .bind(VOTE_SET.set, sid, body.round);
    let row = await look.first();
    if (!row) { return notFound(); }                                           // no such vote (yet)
    if (row.pref === '' && !row.opened && !row.recap) {
      const [set] = await env.DB.batch([env.DB.prepare("UPDATE votes SET pref = ? WHERE vset = ? AND sitting = ? AND round = ? AND pref = '' " +
        'AND opened = 0 AND recap = 0 RETURNING id').bind(body.pref, VOTE_SET.set, sid, body.round),
      ...touch(env.DB, row.day, Date.now(), true)]);
      if (set.results.length) { return reply({ ok: true, pref: body.pref }); }
      row = await look.first();                                                // another request got there first
      if (!row) { return notFound(); }
    }
    if (row.pref !== body.pref) { return reply({ ok: false, reason: 'closed' }, 409); }
  } catch (e) {
    return unconfirmed();
  }
  return reply({ ok: true, pref: body.pref });
}

// POST /api/vote-opened : { set, sitting, round } : the visitor pressed "Show who wrote this" for a round they
// had voted on. 404 "not-found" when there is no such vote. Sent again for the same vote it is 200 and writes nothing.
export async function markOpened(context) {
  const got = await saved(context, 'opened', (b) => whole(b.round, 1, MAX_ROUND));
  if (got.reply) { return got.reply; }
  const { body, env, sid } = got;
  try {
    const row = await env.DB.prepare('SELECT day, opened FROM votes WHERE vset = ? AND sitting = ? AND round = ?')
      .bind(VOTE_SET.set, sid, body.round).first();
    if (!row) { return notFound(); }
    if (!row.opened) {
      await env.DB.batch([env.DB.prepare('UPDATE votes SET opened = 1 WHERE vset = ? AND sitting = ? AND round = ? AND opened = 0')
        .bind(VOTE_SET.set, sid, body.round), ...touch(env.DB, row.day, Date.now(), false)]);
    }
  } catch (e) {
    return unconfirmed();
  }
  return reply({ ok: true });
}

// POST /api/vote-recap : { set, sitting } : the list of the sitting's rounds was shown, with every model's name.
// Marks every saved vote of the sitting. 404 "not-found" when the sitting has no saved vote. Sent again when
// every vote is marked already, it is 200 and writes nothing.
export async function markRecap(context) {
  const got = await saved(context, 'recap', () => true);
  if (got.reply) { return got.reply; }
  const { env, sid } = got;
  try {
    const rows = (await env.DB.prepare('SELECT day, recap FROM votes WHERE vset = ? AND sitting = ?')
      .bind(VOTE_SET.set, sid).all()).results;
    if (!rows.length) { return notFound(); }
    const days = [...new Set(rows.filter((row) => !row.recap).map((row) => row.day))];
    if (days.length) {
      const now = Date.now();
      await env.DB.batch([env.DB.prepare('UPDATE votes SET recap = 1 WHERE vset = ? AND sitting = ? AND recap = 0')
        .bind(VOTE_SET.set, sid), ...days.flatMap((day) => touch(env.DB, day, now, false))]);
    }
    return reply({ ok: true, votes: rows.length });
  } catch (e) {
    return unconfirmed();
  }
}

// GET /api/results[?set=NAME] : public counts for one set: the current one, or an earlier one by name (earlier
// sets stay readable). Finished UTC days only: "through" is the last day counted, and "votes" and "sittings" count
// those days. One row for each mix of model, message, experience, rating, preference, first, opened_before and
// flagged that has votes, with its count. "updated" is when these counts were made. May be cached for a minute.
// Served from the kept copy (see the top of this file). A set name that is not the current set and has no votes
// keeps nothing, so made-up names write nothing.
const RESULT_FIELDS = ['model', 'question', 'experience', 'vote', 'pref', 'first', 'opened_before', 'flagged', 'n'];
const COUNT = 'SELECT model, question, experience, vote, pref, ' +
  '(id IN (SELECT MIN(f.id) FROM votes f WHERE f.vset = ? GROUP BY f.sitting)) AS first, opened_before, ' +
  "(flags <> '') AS flagged, COUNT(*) AS n FROM votes WHERE vset = ? AND day <= ? " +
  'GROUP BY model, question, experience, vote, pref, first, opened_before, flagged';
const KEPT_HEAD = '(SELECT made FROM vote_kept WHERE key = ? AND part = 0)';

// Kept rows are written a few at a time: at most four parts, about 1 MB of text, in one step (one batch).
async function inSteps(db, writes) {
  for (let at = 0; at < writes.length; at += 4) { await db.batch(writes.slice(at, at + 4)); }
}

async function keptResults(db, set, now) {
  const key = 'results:' + set;
  const through = RESULTS_RULE.through(dayOf(now));
  const parts = (await db.prepare('SELECT part, body, made, mark FROM vote_kept WHERE key = ? ORDER BY part').bind(key).all()).results;
  const head = parts.length && parts[0].part === 0 ? parts[0] : null;
  let copy = null;
  if (head && head.body) {
    try { copy = JSON.parse(parts.map((p) => p.body).join('')); } catch (e) { copy = null; }
  }
  if (copy && !stale(copy, head, now, through)) { return copy; }

  // Count again. Where a row for this set exists, only the one request that moves its "made" time goes on, so
  // requests arriving together count once; the others serve the copy as it is.
  if (head) {
    const mine = (await db.prepare('UPDATE vote_kept SET made = ? WHERE key = ? AND part = 0 AND made = ? RETURNING part')
      .bind(now, key, head.made).all()).results.length > 0;
    if (!mine && copy) { return copy; }
  }
  const rows = (await db.prepare(COUNT).bind(set, set, through).all()).results;
  const sum = (list) => list.reduce((a, row) => a + row.n, 0);
  const fresh = { through, built: new Date(now).toISOString(), seen: head ? head.mark : 0, votes: sum(rows),
    sittings: sum(rows.filter((row) => row.first)),                            // every sitting has exactly one first vote
    rows: rows.map((row) => RESULT_FIELDS.map((f) => row[f])) };
  if (fresh.votes > 0 || head || set === VOTE_SET.set) {                      // a made-up set name, with no votes and no row, keeps nothing
    // Kept as JSON in plain ASCII, cut into parts. Each statement applies only while this request's "made" time is
    // still the one on the row, so a slower request cannot write over a newer copy.
    const text = JSON.stringify(fresh).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const cut = [];
    for (let at = 0; at < text.length; at += PART_CHARS) { cut.push(text.slice(at, at + PART_CHARS)); }
    const writes = [
      db.prepare('INSERT INTO vote_kept (key, part, body, made, mark) VALUES (?, 0, ?, ?, 0) ' +
        'ON CONFLICT(key, part) DO UPDATE SET body = excluded.body WHERE vote_kept.made = excluded.made').bind(key, cut[0], now),
      ...cut.slice(1).map((body, i) => db.prepare('INSERT INTO vote_kept (key, part, body, made, mark) ' +
        `SELECT ?, ?, ?, ?, 0 WHERE ${KEPT_HEAD} = ? ON CONFLICT(key, part) DO UPDATE SET body = excluded.body, made = excluded.made`)
        .bind(key, i + 1, body, now, key, now)),
      db.prepare(`DELETE FROM vote_kept WHERE key = ? AND part >= ? AND ${KEPT_HEAD} = ?`).bind(key, cut.length, key, now),
    ];
    try {
      await inSteps(db, writes);     // a copy that is only part written does not read as JSON, so it is counted again
    } catch (e) { /* the counts are right; the next read keeps them */ }
  }
  return fresh;
}

export async function results(context) {
  const { request, env } = context;
  if (!open(env)) { return notConnected(); }
  const set = new URL(request.url).searchParams.get('set') || VOTE_SET.set;
  if (!SET_NAME.test(set)) { return badRequest(); }
  await sweep(env.DB);
  try {
    await ensureVotes(env.DB);
    const copy = await keptResults(env.DB, set, Date.now());
    return reply({ ok: true, set, current: VOTE_SET.set, min_votes: VOTE_SET.min_votes, updated: copy.built,
      through: copy.through, votes: copy.votes, sittings: copy.sittings,
      rows: copy.rows.map((row) => Object.fromEntries(RESULT_FIELDS.map((f, i) => [f, row[i]]))) },
    200, { 'cache-control': 'public, max-age=60' });
  } catch (e) {
    return failed();
  }
}

// GET /api/votes.csv : every vote from finished days (UTC), of every set, for anyone to download and count again.
// Today's votes join the file tomorrow, and the lines are in an order that hides the order of arrival.
// Served from the kept lines of each finished day (see the top of this file). The first read after a day ends
// reads that day's votes once and keeps its lines; every later read is the kept rows only.
export const COLUMNS = ['day', 'sitting', 'round', 'first', 'experience', 'question', 'model', 'vote', 'pref', 'seconds',
  'opened', 'recap', 'opened_before', 'check', 'flags', 'set'];
const KEPT_REV = "COALESCE((SELECT mark FROM vote_kept WHERE key = 'csv' AND part = 0), 0)";
export async function votesCsv(context) {
  const { env } = context;
  if (!open(env)) { return notConnected(); }
  await sweep(env.DB);
  try {
    await ensureVotes(env.DB);
    const db = env.DB;
    const now = Date.now();
    const today = dayOf(now);
    const last = dayBefore(today);                                             // the newest finished day
    const kept = (await db.prepare("SELECT key, part, body, mark FROM vote_kept WHERE key >= 'csv' AND key < 'csv;' " +
      'ORDER BY key, part').all()).results;
    const marker = kept.find((row) => row.key === 'csv');
    let through = marker ? marker.body : '';                                   // every finished day up to here is kept, or has no votes
    const rev = marker ? marker.mark : 0;
    // A day's part 0 is written last and says how many parts the day has (in mark). A day counts as kept only
    // when part 0 and every part it names are there.
    const found = new Map();
    for (const row of kept) {
      if (row.key !== 'csv') { found.set(row.key.slice(4), [...(found.get(row.key.slice(4)) || []), row]); }
    }
    const days = new Map();                                                    // day -> its parts, in order
    for (const [day, rows] of found) {
      const n = rows[0].part === 0 ? rows[0].mark : 0;
      const whole = n > 0 && rows.length >= n && rows.slice(0, n).every((row, i) => row.part === i);
      if (whole && day < today) { days.set(day, rows.slice(0, n).map((row) => row.body)); }
      if (!whole && day <= through) { through = ''; }                          // never expected; if it happens, look at every finished day again
    }
    if (through < last) {
      // Finished days newer than the kept ones: read their votes once, in the file's own order, and keep each
      // day's lines. Days whose lines are kept already are left as they are.
      const got = (await db.prepare(`SELECT day, sitting, round, ${FIRST} AS first, experience, question, model, vote, ` +
        'pref, seconds, opened, recap, opened_before, is_check AS "check", flags, vset AS "set" FROM votes ' +
        'WHERE day > ? AND day < ? ORDER BY day, vset, sitting, round').bind(through, today).all()).results;
      const made = new Map();
      for (const r of got) {
        if (days.has(r.day)) { continue; }
        const line = COLUMNS.map((c) => String(r[c])).join(',') + '\n';        // every value is a code, a number or a date: no commas or quotes can occur
        const parts = made.get(r.day) || made.set(r.day, ['']).get(r.day);
        if (parts[parts.length - 1] !== '' && parts[parts.length - 1].length + line.length > PART_CHARS) { parts.push(''); }
        parts[parts.length - 1] += line;
      }
      // Keep them. Every statement applies only if no vote of a finished day has changed since this read began
      // (the change number is still the same); if one has, nothing is kept and the next read does it again.
      const writes = [];
      for (const [day, parts] of made) {
        days.set(day, parts);
        for (let part = parts.length - 1; part >= 0; part--) {                 // part 0 last: it makes the day count as kept
          writes.push(db.prepare('INSERT INTO vote_kept (key, part, body, made, mark) ' +
            `SELECT ?, ?, ?, ?, ? WHERE ${KEPT_REV} = ? ON CONFLICT(key, part) DO UPDATE SET body = excluded.body, made = excluded.made, mark = excluded.mark`)
            .bind('csv:' + day, part, parts[part], now, part === 0 ? parts.length : 0, rev));
        }
      }
      writes.push(db.prepare("INSERT INTO vote_kept (key, part, body, made, mark) SELECT 'csv', 0, ?, 0, 0 " +
        `WHERE ${KEPT_REV} = ? ON CONFLICT(key, part) DO UPDATE SET body = MAX(vote_kept.body, excluded.body)`).bind(last, rev));
      try {
        await inSteps(db, writes);                                             // the mark of "covered through" goes last of all
      } catch (e) { /* the file is right; the next read keeps the lines */ }
    }
    const lines = [...days.keys()].sort().map((day) => days.get(day).join('')).join('');
    return new Response(COLUMNS.join(',') + '\n' + lines, {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'public, max-age=60',
        'content-disposition': 'attachment; filename="friendsof4o-votes.csv"', 'x-content-type-options': 'nosniff' },
    });
  } catch (e) {
    return failed();
  }
}
