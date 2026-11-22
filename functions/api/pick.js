// POST /api/pick : one pick in the guessing game. Body: { question, other, otherCondition, picked, preferred? }
// Not connected. It stores nothing and answers 501, so nothing can be recorded by accident.
// See functions/README.md for what must be decided before this goes live.
import { notConnected } from '../../lib/forms.js';

export async function onRequestPost() {
  return notConnected();
}
