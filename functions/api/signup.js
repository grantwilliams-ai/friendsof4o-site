// POST /api/signup : a mailing-list signup. Body: { email, website? }
// The address goes to the mailing service (Kit) and nowhere else; this site keeps no copy.
// Answers 501 until KIT_API_KEY, KIT_FORM_ID and the database DB (used only for the hourly limits) are set in the
// Cloudflare Pages project.
import { reply, notConnected, badRequest, failed, unconfirmed, readBody, isRobot, cleanEmail, ensureTables, checkLimit }
  from '../../lib/forms.js';

const KIT = 'https://api.kit.com/v4';
const WAIT_MS = 8000;             // longest wait for each Kit call

export async function onRequestPost({ request, env }) {
  if (!env.KIT_API_KEY || !env.KIT_FORM_ID || !env.DB) { return notConnected(); }
  const { body, reply: refused } = await readBody(request);
  if (refused) { return refused; }
  const robot = isRobot(body);
  if (robot === null) { return badRequest(); }
  if (robot) { return reply({ ok: true }); }                        // send nothing
  const email = cleanEmail(body.email);
  if (!email) { return badRequest(); }

  // The limit comes before any call to Kit.
  try {
    await ensureTables(env.DB);
    const busy = await checkLimit(request, env.DB, 'signup');
    if (busy) { return busy; }
  } catch (e) {
    return failed();                                                 // nothing was sent
  }

  const headers = { 'content-type': 'application/json', 'X-Kit-Api-Key': env.KIT_API_KEY };
  const call = (url, payload) => fetch(url, {
    method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(WAIT_MS),
  });

  // Step 1: make (or find) the subscriber. From here on, a failure may have reached Kit, so it is "unconfirmed",
  // except a plain refusal of the address (4xx), which creates nothing.
  let id;
  try {
    const made = await call(KIT + '/subscribers', { email_address: email });
    if (!made.ok) { return made.status >= 400 && made.status < 500 ? failed() : unconfirmed(); }
    const data = await made.json();
    id = data && data.subscriber && data.subscriber.id;
  } catch (e) {
    return unconfirmed();
  }
  if (typeof id !== 'number' && typeof id !== 'string') { return unconfirmed(); }

  // Step 2: add the subscriber to the site's form, which is what sends the confirmation email.
  try {
    const added = await call(`${KIT}/forms/${encodeURIComponent(env.KIT_FORM_ID)}/subscribers/${encodeURIComponent(id)}`,
      { referrer: new URL(request.url).origin + '/' });
    if (!added.ok) { return unconfirmed(); }
  } catch (e) {
    return unconfirmed();
  }
  return reply({ ok: true });
}
