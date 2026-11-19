// Shared by the three form endpoints in functions/api/. Not a route itself.
// Each endpoint answers 501 "not-connected" until its setting exists in the Cloudflare Pages project,
// so a deploy without settings stores nothing and sends nothing.

export function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const notConnected = () => reply({ ok: false, reason: 'not-connected' }, 501);

// Only this site's own pages may post, and only small JSON bodies.
export async function readBody(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) { return null; }
  const raw = await request.text();
  if (raw.length > 6000) { return null; }
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' ? body : null;
  } catch (e) {
    return null;
  }
}

export function cleanEmail(value) {
  const email = String(value || '').trim();
  if (!email) { return ''; }
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// A free-text message (kind "suggestion" or "ask") goes into the site's own D1 database, binding name DB.
// Kept: the kind, the text, the optional email address, the time. Nothing else: no IP address, no browser details.
export async function storeMessage(context, kind) {
  const { request, env } = context;
  if (!env.DB) { return notConnected(); }
  const body = await readBody(request);
  if (!body) { return reply({ ok: false, reason: 'bad-request' }, 400); }
  if (body.website) { return reply({ ok: true }); }                 // the hidden box was filled: a robot. Keep nothing.
  const text = String(body.text || '').trim();
  const email = cleanEmail(body.email);
  if (!text || text.length > 2000 || email === null) { return reply({ ok: false, reason: 'bad-request' }, 400); }

  await env.DB.prepare('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ' +
    'text TEXT NOT NULL, email TEXT NOT NULL, created TEXT NOT NULL)').run();
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE created > ?').bind(hourAgo).first();
  if (recent && recent.n >= 200) { return reply({ ok: false, reason: 'busy' }, 429); }   // a flood: stop taking more
  await env.DB.prepare('INSERT INTO messages (kind, text, email, created) VALUES (?, ?, ?, ?)')
    .bind(kind, text, email, new Date().toISOString()).run();
  return reply({ ok: true });
}
