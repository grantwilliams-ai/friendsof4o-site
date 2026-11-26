// POST /api/vote-opened : the visitor pressed "Show who wrote this" for a round they had voted on (lib/vote.js).
// Body: { set, sitting, round }. 501 until the vote is switched on.
import { markOpened } from '../../lib/vote.js';
export const onRequestPost = (context) => markOpened(context);
