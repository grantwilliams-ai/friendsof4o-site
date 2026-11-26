// POST /api/vote : one vote in "Which model sounds most like GPT-4o?" (lib/vote.js).
// Body: { set, sitting, round, experience, question, model, vote, seconds, opened_before, website }.
// Answers 501 and keeps nothing until the database is attached AND the setting VOTE_OPEN is "yes".
import { storeVote } from '../../lib/vote.js';
export const onRequestPost = (context) => storeVote(context);
