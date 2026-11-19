// POST /api/signup : a mailing-list signup. Body: { email, website? }
// The address goes to the mailing service (Kit) and nowhere else; this site keeps no copy.
// Answers 501 until KIT_API_KEY and KIT_FORM_ID are set in the Cloudflare Pages project.
import { reply, notConnected, readBody, cleanEmail } from '../../lib/forms.js';

const KIT = 'https://api.kit.com/v4';

export async function onRequestPost({ request, env }) {
  if (!env.KIT_API_KEY || !env.KIT_FORM_ID) { return notConnected(); }
  const body = await readBody(request);
  if (!body) { return reply({ ok: false, reason: 'bad-request' }, 400); }
  if (body.website) { return reply({ ok: true }); }                 // a robot. Send nothing.
  const email = cleanEmail(body.email);
  if (!email) { return reply({ ok: false, reason: 'bad-request' }, 400); }

  const headers = { 'content-type': 'application/json', 'X-Kit-Api-Key': env.KIT_API_KEY };
  const made = await fetch(KIT + '/subscribers', {
    method: 'POST', headers, body: JSON.stringify({ email_address: email }),
  });
  if (!made.ok) { return reply({ ok: false, reason: 'service' }, 502); }
  const id = (await made.json()).subscriber.id;
  const added = await fetch(`${KIT}/forms/${env.KIT_FORM_ID}/subscribers/${id}`, {
    method: 'POST', headers, body: JSON.stringify({ referrer: new URL(request.url).origin + '/' }),
  });
  if (!added.ok) { return reply({ ok: false, reason: 'service' }, 502); }
  return reply({ ok: true });
}
