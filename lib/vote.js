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
// "first" is not a column. It is worked out when the results or the download are read: the vote with the lowest
// id among the saved votes of its sitting, which is the first vote the server saved for that sitting. It is not
// "round 1": a sitting whose first vote failed to save has its first saved vote in round 2.
import { reply, notConnected, badRequest, failed, unconfirmed, readBody, isRobot, checkLimit, ensureTables, sweep } from './forms.js';
import { VOTE_SET } from './vote-set.js';

const VOTES = 'CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, ' +
  'sitting TEXT NOT NULL, round INTEGER NOT NULL, experience TEXT NOT NULL, question TEXT NOT NULL, ' +
  "model TEXT NOT NULL, vote TEXT NOT NULL, pref TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL, " +
  'opened INTEGER NOT NULL DEFAULT 0, recap INTEGER NOT NULL DEFAULT 0, opened_before INTEGER NOT NULL, ' +
  'is_check INTEGER NOT NULL, flags TEXT NOT NULL, vset TEXT NOT NULL, UNIQUE (vset, sitting, round))';
const ready = new WeakSet();
async function ensureVotes(db) {
  await ensureTables(db);                      // the limits table
  if (ready.has(db)) { return; }
  await db.prepare(VOTES).run();
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
    const busy = await checkLimit(request, env.DB, 'vote');
    if (busy) { return busy; }
    sid = await publicSitting(VOTE_SET.set, b.sitting);
    const saved = (await env.DB.prepare('SELECT round, question, model, vote FROM votes WHERE vset = ? AND sitting = ?')
      .bind(VOTE_SET.set, sid).all()).results;
    const before = saved.find((row) => row.round === b.round);
    if (before) { return same(before) ? again(before) : badRequest(); }       // this round is already kept
    if (saved.some(same) || saved.some((row) => row.question === b.question || row.model === b.model)) {
      return badRequest();                                                     // no message and no model twice in a sitting
    }
    if (!saved.length) {
      // A sitting with no saved vote is a new sitting, whatever round number the page claims, and new sittings
      // have their own, lower limit. The counter goes up in one statement, so two new sittings arriving together
      // cannot both take the last place. Two requests for the same new sitting arriving together are both
      // charged: the limit can be stricter than it says for a moment, never looser.
      const full = await checkLimit(request, env.DB, 'sitting');
      if (full) { return full; }
    }
  } catch (e) {
    return failed();                                                           // nothing was kept
  }
  const flags = [];
  if (b.seconds < FAST_SECONDS) { flags.push('fast'); }
  if (b.round > VOTE_SET.rounds_max) { flags.push('extra'); }
  try {
    // One statement decides: the row goes in only if this round is not kept yet and neither the message nor the
    // model is in the sitting already, so two requests arriving together cannot both get in.
    const kept = await env.DB.prepare('INSERT OR IGNORE INTO votes (day, sitting, round, experience, question, model, ' +
      'vote, seconds, opened_before, is_check, flags, vset) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS ' +
      '(SELECT 1 FROM votes WHERE vset = ? AND sitting = ? AND (question = ? OR model = ?)) RETURNING id')
      .bind(new Date().toISOString().slice(0, 10), sid, b.round, b.experience, b.question, b.model, b.vote,
        Math.floor(b.seconds), b.opened_before ? 1 : 0, b.model === VOTE_SET.check ? 1 : 0, flags.join(' '),
        VOTE_SET.set, VOTE_SET.set, sid, b.question, b.model).all();
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
    const busy = await checkLimit(request, env.DB, kind);
    if (busy) { return { reply: busy }; }
  } catch (e) {
    return { reply: failed() };
  }
  return { body, env, sid: await publicSitting(VOTE_SET.set, body.sitting) };
}

// POST /api/vote-pref : { set, sitting, round, pref } : the answer to "Would you like a reply like this?" for a
// round already voted on. A pass sends nothing, so the row keeps ''. The answer is taken once, and only while no
// name has been shown for that vote: after "Show who wrote this" or the list of rounds it answers 409 "closed".
// The same answer sent again is 200 (a retry).
export async function storePref(context) {
  const got = await saved(context, 'pref', (b) => whole(b.round, 1, MAX_ROUND) && PREFS.includes(b.pref));
  if (got.reply) { return got.reply; }
  const { body, env, sid } = got;
  try {
    const set = await env.DB.prepare("UPDATE votes SET pref = ? WHERE vset = ? AND sitting = ? AND round = ? AND pref = '' " +
      'AND opened = 0 AND recap = 0 RETURNING id').bind(body.pref, VOTE_SET.set, sid, body.round).all();
    if (!set.results.length) {
      const row = await env.DB.prepare('SELECT pref FROM votes WHERE vset = ? AND sitting = ? AND round = ?')
        .bind(VOTE_SET.set, sid, body.round).first();
      if (!row) { return notFound(); }                                         // no such vote (yet)
      if (row.pref !== body.pref) { return reply({ ok: false, reason: 'closed' }, 409); }
    }
  } catch (e) {
    return unconfirmed();
  }
  return reply({ ok: true, pref: body.pref });
}

// POST /api/vote-opened : { set, sitting, round } : the visitor pressed "Show who wrote this" for a round they
// had voted on. 404 "not-found" when there is no such vote.
export async function markOpened(context) {
  const got = await saved(context, 'opened', (b) => whole(b.round, 1, MAX_ROUND));
  if (got.reply) { return got.reply; }
  const { body, env, sid } = got;
  try {
    const set = await env.DB.prepare('UPDATE votes SET opened = 1 WHERE vset = ? AND sitting = ? AND round = ? RETURNING id')
      .bind(VOTE_SET.set, sid, body.round).all();
    if (!set.results.length) { return notFound(); }
  } catch (e) {
    return unconfirmed();
  }
  return reply({ ok: true });
}

// POST /api/vote-recap : { set, sitting } : the list of the sitting's rounds was shown, with every model's name.
// Marks every saved vote of the sitting. 404 "not-found" when the sitting has no saved vote.
export async function markRecap(context) {
  const got = await saved(context, 'recap', () => true);
  if (got.reply) { return got.reply; }
  const { env, sid } = got;
  try {
    const set = await env.DB.prepare('UPDATE votes SET recap = 1 WHERE vset = ? AND sitting = ? RETURNING id')
      .bind(VOTE_SET.set, sid).all();
    if (!set.results.length) { return notFound(); }
    return reply({ ok: true, votes: set.results.length });
  } catch (e) {
    return unconfirmed();
  }
}

// GET /api/results[?set=NAME] : public counts for one set: the current one, or an earlier one by name (earlier
// sets stay readable). One row for each mix of model, message, experience, rating, preference, first, opened_before
// and flagged that has votes, with its count. May be cached for a minute.
export async function results(context) {
  const { request, env } = context;
  if (!open(env)) { return notConnected(); }
  const set = new URL(request.url).searchParams.get('set') || VOTE_SET.set;
  if (!SET_NAME.test(set)) { return badRequest(); }
  await sweep(env.DB);
  try {
    await ensureVotes(env.DB);
    const [rows, totals] = await env.DB.batch([
      env.DB.prepare(`SELECT model, question, experience, vote, pref, ${FIRST} AS first, opened_before, ` +
        "(flags <> '') AS flagged, COUNT(*) AS n FROM votes WHERE vset = ? " +
        'GROUP BY model, question, experience, vote, pref, first, opened_before, flagged').bind(set),
      env.DB.prepare('SELECT COUNT(*) AS votes, COUNT(DISTINCT sitting) AS sittings FROM votes WHERE vset = ?').bind(set),
    ]);
    const t = totals.results[0] || { votes: 0, sittings: 0 };
    return reply({ ok: true, set, current: VOTE_SET.set, min_votes: VOTE_SET.min_votes, updated: new Date().toISOString(),
      votes: t.votes, sittings: t.sittings, rows: rows.results }, 200, { 'cache-control': 'public, max-age=60' });
  } catch (e) {
    return failed();
  }
}

// GET /api/votes.csv : every vote from finished days (UTC), of every set, for anyone to download and count again.
// Today's votes join the file tomorrow, and the lines are in an order that hides the order of arrival.
export const COLUMNS = ['day', 'sitting', 'round', 'first', 'experience', 'question', 'model', 'vote', 'pref', 'seconds',
  'opened', 'recap', 'opened_before', 'check', 'flags', 'set'];
export async function votesCsv(context) {
  const { env } = context;
  if (!open(env)) { return notConnected(); }
  await sweep(env.DB);
  try {
    await ensureVotes(env.DB);
    const got = await env.DB.prepare(`SELECT day, sitting, round, ${FIRST} AS first, experience, question, model, vote, ` +
      'pref, seconds, opened, recap, opened_before, is_check AS "check", flags, vset AS "set" FROM votes WHERE day < ? ' +
      'ORDER BY day, vset, sitting, round').bind(new Date().toISOString().slice(0, 10)).all();
    const lines = [COLUMNS.join(',')];
    for (const r of got.results) { lines.push(COLUMNS.map((c) => String(r[c])).join(',')); }   // every value is a code, a number or a date: no commas or quotes can occur
    return new Response(lines.join('\n') + '\n', {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'public, max-age=60',
        'content-disposition': 'attachment; filename="friendsof4o-votes.csv"', 'x-content-type-options': 'nosniff' },
    });
  } catch (e) {
    return failed();
  }
}
