// POST /api/vote-pref : the answer to "Would you like a reply like this?" for a round already voted on (lib/vote.js).
// Body: { set, sitting, round, pref }. Answers 501 and keeps nothing until the vote is switched on.
import { storePref } from '../../lib/vote.js';
export const onRequestPost = (context) => storePref(context);
