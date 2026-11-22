// Shared by the three form endpoints in functions/api/. Not a route itself.
// Each endpoint answers 501 "not-connected" until its setting exists in the Cloudflare Pages project,
// so a deploy without settings stores nothing and sends nothing.
//
// What a reply's "reason" means to the page (static/js/site.js):
//   not-connected  the form is switched off; nothing was kept or sent
//   bad-request    the words or address were not accepted; nothing was kept or sent
//   busy           too many sends in the last hour (429, with Retry-After); nothing was kept or sent
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
// Two counters per form, both for the current clock hour:
//   one per sender: so one sender cannot use up everybody's hour
//   one for the whole site: so many senders together cannot flood the store or the mailing service
// A sender is known only by a scrambled code (SHA-256 of a random value for this hour, the connection's address,
// the form and the hour). The address itself is never written down. The random value and every counter carry an
// expiry at the end of their hour and are deleted after it, so after an hour nothing is left that could tie a code
// to an address. Each counter goes up in one statement (an upsert), so requests that arrive together cannot slip past.
export const LIMITS = {
  signup: { sender: 5, site: 200 },
  suggestion: { sender: 10, site: 200 },
  ask: { sender: 10, site: 200 },
};
const HOUR = 3600;

// Returns null when the send may go ahead, or a ready 429 reply. Throws if the database fails.
export async function checkLimit(request, db, kind) {
  const rule = LIMITS[kind];
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / HOUR);
  const until = (hour + 1) * HOUR;
  const saltKey = `salt:${hour}`;
  const fresh = crypto.getRandomValues(new Uint32Array(2));
  const [, , got] = await db.batch([
    db.prepare('DELETE FROM form_limits WHERE until <= ?').bind(now),
    db.prepare('INSERT OR IGNORE INTO form_limits (key, n, until) VALUES (?, ?, ?)')
      .bind(saltKey, fresh[0] * 2097152 + (fresh[1] >>> 11), until),
    db.prepare('SELECT n FROM form_limits WHERE key = ?').bind(saltKey),
  ]);
  const salt = got.results[0].n;
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const code = await sha256(`${salt}|${address}|${kind}|${hour}`);

  const bump = (key) => db.prepare('INSERT INTO form_limits (key, n, until) VALUES (?, 1, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET n = form_limits.n + 1 RETURNING n').bind(key, until);
  const later = { 'retry-after': String(Math.max(1, until - now)) };
  const busy = () => reply({ ok: false, reason: 'busy' }, 429, later);

  const sender = await bump(`sender:${kind}:${code}`).first();
  if (sender.n > rule.sender) { return busy(); }
  const site = await bump(`site:${kind}:${hour}`).first();
  if (site.n > rule.site) { return busy(); }
  return null;
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
