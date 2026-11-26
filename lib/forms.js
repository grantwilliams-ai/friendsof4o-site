// Shared by the form endpoints and the vote's endpoints in functions/api/. Not a route itself.
// Each endpoint answers 501 "not-connected" until its setting exists in the Cloudflare Pages project,
// so a deploy without settings stores nothing and sends nothing.
//
// What a reply's "reason" means to the page (static/js/site.js):
//   not-connected  the form is switched off; nothing was kept or sent
//   bad-request    the words or address were not accepted; nothing was kept or sent
//   busy           too many sends in this hour, or for the vote in this UTC day (429, with Retry-After);
//                  nothing was kept or sent, and nothing was written to the database
//   error          something failed before anything was kept or sent
//   unconfirmed    something failed part way: it may or may not have gone through

// Browser safety settings. The site's _headers file does not reach Function replies, so they are set here too.
// A reply is JSON and never a page, so its content policy allows nothing at all.
const SAFETY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

export function reply(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SAFETY, ...extra },
  });
}

export const notConnected = () => reply({ ok: false, reason: 'not-connected' }, 501);
export const badRequest = (status = 400) => reply({ ok: false, reason: 'bad-request' }, status);
export const failed = () => reply({ ok: false, reason: 'error' }, 503);
export const unconfirmed = () => reply({ ok: false, reason: 'unconfirmed' }, 503);

// ---------------------------------------------------------------- reading a request

const MAX_BYTES = 16 * 1024;      // 2,000 characters of text can be up to 8 KB in UTF-8; the rest is room for JSON

// Only this site's own pages may post, and only a small JSON object.
// Returns { body } or { reply } (a ready refusal).
export async function readBody(request) {
  const origin = request.headers.get('origin');
  if (origin !== null) {                          // a browser always sends it with a POST; other clients may not
    let same = false;
    try { same = new URL(origin).origin === new URL(request.url).origin; } catch (e) { same = false; }
    if (!same) { return { reply: badRequest(403) }; }
  }
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') { return { reply: badRequest(415) }; }
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BYTES) { return { reply: badRequest(413) }; }

  let raw;
  try {
    raw = await readCapped(request);
  } catch (e) {
    return { reply: badRequest(400) };
  }
  if (raw === null) { return { reply: badRequest(413) }; }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return { reply: badRequest(400) }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) { return { reply: badRequest(400) }; }
  return { body };
}

// Read the body, stopping as soon as it passes MAX_BYTES (null), whatever its declared length.
async function readCapped(request) {
  if (!request.body) { return ''; }
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { break; }
    size += value.byteLength;
    if (size > MAX_BYTES) { try { await reader.cancel(); } catch (e) { /* already closed */ } return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

// An optional string field: undefined or null counts as empty. Anything that is not a string is refused (null).
export function optionalString(value, max) {
  if (value === undefined || value === null) { return ''; }
  if (typeof value !== 'string' || value.length > max) { return null; }
  return value;
}

// The hidden "website" box: people never see it, so anything in it means a robot. Returns true, false or null (refused).
export function isRobot(body) {
  const trap = optionalString(body.website, 500);
  return trap === null ? null : trap.trim() !== '';
}

// '' for no address, the address if it looks right, null if it does not.
export function cleanEmail(value) {
  const raw = optionalString(value, 400);
  if (raw === null) { return null; }
  const email = raw.trim();
  if (!email) { return ''; }
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// ---------------------------------------------------------------- the database

// Tables are made once per running copy, not on every request.
// The same statements, to run by hand if preferred, are in functions/schema.sql.
const TABLES = [
  'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ' +
    'text TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS form_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)',
];
const ready = new WeakSet();
export async function ensureTables(db) {
  if (ready.has(db)) { return; }
  await db.batch(TABLES.map((sql) => db.prepare(sql)));
  ready.add(db);
}

// ---------------------------------------------------------------- limits
//
// Counters, each for one clock hour or one UTC day:
//   per sender: so one sender cannot use up everybody's hour or day
//   for the whole site: so many senders together cannot flood the store, the mailing service or the day's
//     database allowance
// The forms have the two hourly counters only. The vote (lib/vote.js) has daily ones as well.
//
// Who a sender is: an IPv4 address counts as itself. An IPv6 address counts by its /64 block (its first four
// groups), so one home or one rented block is one sender. An IPv4 address written inside IPv6 (::ffff:a.b.c.d)
// counts as that IPv4 address. Anything that cannot be read counts as the text it is.
//
// A sender is known only by a scrambled code (SHA-256 of a random value, the sender, the kind of send and the hour
// or day). The address itself is never written down. There is one random value for each hour and one for each UTC
// day; each of them and every counter carries an expiry at the end of its hour or day.
//
// A refused send writes nothing: the counters are read first, and a send that finds any of them at its limit is
// answered 429 there, so a loop of refused sends costs reads only, and a refused sender does not use up the site's
// count. A send under its limits adds one to all of its counters in one statement that changes nothing at all if
// any of them is full, so sends that arrive together cannot slip past and none is half counted. (Deleting rows
// whose time is over is the one thing any request may still do; see sweep() below.)
//
// How long they last, exactly: nothing here runs on a clock. Expired rows are deleted by the next API request that
// reaches the database after their hour or day ends: any form send, any vote call, and every read of the vote's
// results or its download (sweep() below). On a site in use that is minutes after the hour or the day. With no such
// request they stay until the next one, however long that is. Every notice on the pages says this, not "within the
// hour". A hard ceiling would need something that runs on a timer (a Cloudflare Cron Trigger); there is none.
//
// The numbers, all in this one place. sender_hour and site_hour are for a clock hour; sender_day and site_day are
// for a UTC day.
export const LIMITS = {
  signup: { sender_hour: 5, site_hour: 200 },
  suggestion: { sender_hour: 10, site_hour: 200 },
  ask: { sender_hour: 10, site_hour: 200 },
  vote: { sender_hour: 60, site_hour: 1500 },       // the public vote (lib/vote.js): a sitting is three to five rounds
  pref: { sender_hour: 60, site_hour: 1500 },       // "Would you like a reply like this?"
  opened: { sender_hour: 60, site_hour: 1500 },     // "Show who wrote this"
  recap: { sender_hour: 60, site_hour: 500 },       // the list of rounds, which names every model
  sitting: { sender_hour: 12, sender_day: 30, site_hour: 150, site_day: 450 },   // new sittings: a sitting's first saved vote, whatever round number it claims
  vote_calls: { site_day: 4500 },                   // vote, pref, opened and recap together
};
const HOUR = 3600;
const DAY = 86400;

// Delete every limit row whose hour or day has ended. Called at the start of every API request that has the
// database, so the rows do not wait for the next send of the same form. It never stops the request: if it fails,
// the request goes on and the next one tries again.
export async function sweep(db) {
  try {
    await ensureTables(db);
    await db.prepare('DELETE FROM form_limits WHERE until <= ?').bind(Math.floor(Date.now() / 1000)).run();
  } catch (e) { /* the request itself decides what to answer */ }
}

// The sender a connection's address counts as (see "Who a sender is" above).
export function senderOf(address) {
  const text = String(address).trim();
  const four = (t) => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
    if (!m) { return null; }
    const n = m.slice(1).map(Number);
    return n.every((x) => x <= 255) ? n : null;
  };
  const v4 = four(text);
  if (v4) { return v4.join('.'); }
  if (!text.includes(':')) { return text; }
  let rest = text.replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();    // no brackets, no zone name
  const cut = rest.lastIndexOf(':');
  const tail = four(rest.slice(cut + 1));                                         // an IPv4 ending, as in ::ffff:a.b.c.d
  if (tail) { rest = rest.slice(0, cut + 1) + (tail[0] * 256 + tail[1]).toString(16) + ':' + (tail[2] * 256 + tail[3]).toString(16); }
  const halves = rest.split('::');
  if (halves.length > 2) { return text; }
  const groups = (t) => (t === '' ? [] : t.split(':'));
  const head = groups(halves[0]);
  const end = halves.length === 2 ? groups(halves[1]) : [];
  const gap = 8 - head.length - end.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) { return text; }
  const all = [...head, ...Array(gap).fill('0'), ...end];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) { return text; }
  const n = all.map((g) => parseInt(g, 16));
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {                  // an IPv4 address written inside IPv6
    return [n[6] >> 8, n[6] & 255, n[7] >> 8, n[7] & 255].join('.');
  }
  return n.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}

// Returns null when the send may go ahead, or a ready 429 reply. Throws if the database fails.
// kinds is one name from LIMITS or a list of them: a list is counted together, all or none.
export async function checkLimit(request, db, kinds) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / HOUR);
  const day = Math.floor(now / DAY);
  const hourEnds = (hour + 1) * HOUR;
  const dayEnds = (day + 1) * DAY;
  const sender = senderOf(request.headers.get('cf-connecting-ip') || 'unknown');

  // What this send is counted against. A site counter's name is known at once. A sender counter's name is a
  // scrambled code that needs the hour's or the day's random value first.
  const site = [];                                  // { key, until, max }
  const mine = [];                                  // { salt, saltEnds, text, start, until, max }: this sender's counters
  for (const kind of [].concat(kinds)) {
    const rule = LIMITS[kind];
    if (rule.sender_hour) {
      mine.push({ salt: `salt:${hour}`, saltEnds: hourEnds, text: `|${sender}|${kind}|${hour}`, start: `sender:${kind}:`, until: hourEnds, max: rule.sender_hour });
    }
    if (rule.sender_day) {
      mine.push({ salt: `day:salt:${day}`, saltEnds: dayEnds, text: `|${sender}|${kind}|day ${day}`, start: `day:sender:${kind}:`, until: dayEnds, max: rule.sender_day });
    }
    if (rule.site_hour) { site.push({ key: `site:${kind}:${hour}`, until: hourEnds, max: rule.site_hour }); }
    if (rule.site_day) { site.push({ key: `day:site:${kind}:${day}`, until: dayEnds, max: rule.site_day }); }
  }
  const read = (keys) => db.prepare(`SELECT key, n FROM form_limits WHERE key IN (${keys.map(() => '?').join(', ')})`).bind(...keys);
  const counts = async (keys) => new Map((await read(keys).all()).results.map((row) => [row.key, row.n]));
  const busy = (until) => reply({ ok: false, reason: 'busy' }, 429, { 'retry-after': String(Math.max(1, until - now)) });
  // A ready 429 if any of these counters is at its limit. Retry-After is the end of the hour, or of the UTC day
  // when a daily counter is the full one.
  const full = (list, at) => {
    const hit = list.filter((c) => (at.get(c.key) || 0) >= c.max);
    return hit.length ? busy(Math.max(...hit.map((c) => c.until))) : null;
  };
  const named = async (list, salts) => Promise.all(list.map(async (c) => ({ ...c, key: c.start + await sha256(salts.get(c.salt) + c.text) })));

  // Read first, and write nothing until every counter has been seen under its limit.
  // 1. The site's counters and the random values, in one read.
  const saltKeys = [...new Set(mine.map((c) => c.salt))];
  const seen = await counts([...saltKeys, ...site.map((c) => c.key)]);
  const siteFull = full(site, seen);
  if (siteFull) { return siteFull; }
  // 2. This sender's counters, where the random value exists. Where it does not, this is the first send of the
  //    hour or the day to need it, so no counter under it can exist yet.
  const known = await named(mine.filter((c) => seen.has(c.salt)), seen);
  if (known.length) {
    const senderFull = full(known, await counts(known.map((c) => c.key)));
    if (senderFull) { return senderFull; }
  }
  // 3. The send is going ahead: make a missing random value (once an hour, once a day).
  const missing = saltKeys.filter((key) => !seen.has(key));
  let unknown = [];
  if (missing.length) {
    const fresh = crypto.getRandomValues(new Uint32Array(2 * missing.length));
    const out = await db.batch([
      ...missing.map((key, i) => db.prepare('INSERT OR IGNORE INTO form_limits (key, n, until) VALUES (?, ?, ?)')
        .bind(key, fresh[2 * i] * 2097152 + (fresh[2 * i + 1] >>> 11), mine.find((c) => c.salt === key).saltEnds)),
      read(missing),
    ]);
    unknown = await named(mine.filter((c) => !seen.has(c.salt)), new Map(out[out.length - 1].results.map((row) => [row.key, row.n])));
  }
  // 4. Count: one statement adds one to every counter, or to none of them if any has filled up meanwhile.
  const counters = [...known, ...unknown, ...site];
  const counted = await db.prepare(
    `WITH c(key, until, max) AS (VALUES ${counters.map(() => '(?, ?, ?)').join(', ')}) ` +
    'INSERT INTO form_limits (key, n, until) SELECT key, 1, until FROM c ' +
    'WHERE NOT EXISTS (SELECT 1 FROM form_limits f JOIN c AS x ON x.key = f.key WHERE f.n >= x.max) ' +
    'ON CONFLICT(key) DO UPDATE SET n = form_limits.n + 1 RETURNING key')
    .bind(...counters.flatMap((c) => [c.key, c.until, c.max])).all();
  if (counted.results.length) { return null; }
  // Another send took the last place between the read and the count.
  return full(counters, await counts(counters.map((c) => c.key))) || busy(hourEnds);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- free-text messages

// A free-text message (kind "suggestion" or "ask") goes into the site's own D1 database, binding name DB.
// Kept: the kind, the text, the optional email address, the time. Nothing else: no IP address, no browser details.
// The same words with the same address on the same form within a day are kept once, so a second click or a
// retry after an unclear answer does not count twice.
export async function storeMessage(context, kind) {
  const { request, env } = context;
  if (!env.DB) { return notConnected(); }
  await sweep(env.DB);                                              // expired limit rows go, whatever this request is
  const { body, reply: refused } = await readBody(request);
  if (refused) { return refused; }
  const robot = isRobot(body);
  if (robot === null) { return badRequest(); }
  if (robot) { return reply({ ok: true }); }                        // keep nothing
  if (typeof body.text !== 'string') { return badRequest(); }
  const text = body.text.trim();
  const email = cleanEmail(body.email);
  if (!text || text.length > 2000 || email === null) { return badRequest(); }

  try {
    await ensureTables(env.DB);
    const busy = await checkLimit(request, env.DB, kind);
    if (busy) { return busy; }
  } catch (e) {
    return failed();                                                 // nothing was kept
  }
  try {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO messages (kind, text, email, created) SELECT ?, ?, ?, ? WHERE NOT EXISTS ' +
      '(SELECT 1 FROM messages WHERE kind = ? AND text = ? AND email = ? AND created > ?)')
      .bind(kind, text, email, new Date(now).toISOString(), kind, text, email, dayAgo).run();
  } catch (e) {
    return unconfirmed();                                            // it may or may not have been kept
  }
  return reply({ ok: true });
}
