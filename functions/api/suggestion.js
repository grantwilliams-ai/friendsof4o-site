// POST /api/suggestion : "Tell us what you need". Body: { text, email?, website? }
// Stored in the site's own database (lib/forms.js). Answers 501 until the database is attached.
import { storeMessage } from '../../lib/forms.js';
export const onRequestPost = (context) => storeMessage(context, 'suggestion');
