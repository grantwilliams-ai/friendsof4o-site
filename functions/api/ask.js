// POST /api/ask : a question for GPT-4o. Body: { text, email?, website? }
// Stored in the site's own database (lib/forms.js). Answers 501 until the database is attached.
// The form closes after January 7, 2027 (US Eastern): GPT-4o's last two versions leave OpenAI's API on January 14.
// The page hides the form from the same day (content/home.json, forms.ask.closes).
import { storeMessage, reply } from '../../lib/forms.js';

const CLOSES = '2027-01-08';   // the first day the form is shut, as a US Eastern date

function easternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit' }).formatToParts(now);
  const got = {};
  for (const p of parts) { got[p.type] = p.value; }
  return `${got.year}-${got.month}-${got.day}`;
}

export const onRequestPost = (context) => (
  easternDate() >= CLOSES ? reply({ ok: false, reason: 'closed' }, 410) : storeMessage(context, 'ask')
);
