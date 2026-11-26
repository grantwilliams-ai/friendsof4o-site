// GET /api/results[?set=NAME] : the vote's public counts for the current set, or an earlier one by name (lib/vote.js).
// 501 until the vote is switched on.
import { results } from '../../lib/vote.js';
export const onRequestGet = (context) => results(context);
