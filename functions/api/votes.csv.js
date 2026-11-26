// GET /api/votes.csv : every vote from finished UTC days, as a file anyone can download (lib/vote.js).
// 501 until the vote is switched on.
import { votesCsv } from '../../lib/vote.js';
export const onRequestGet = (context) => votesCsv(context);
