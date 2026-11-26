// POST /api/vote-recap : the list of a sitting's rounds was shown, with every model's name (lib/vote.js).
// Body: { set, sitting }. Marks every saved vote of that sitting. 501 until the vote is switched on.
import { markRecap } from '../../lib/vote.js';
export const onRequestPost = (context) => markRecap(context);
