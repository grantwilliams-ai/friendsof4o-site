// POST /api/pick : one pick in the guessing game. Body: { question, other, otherCondition, picked, preferred? }
// Not connected. It stores nothing and answers 501, so nothing can be recorded by accident.
// See functions/README.md for what must be decided before this goes live.
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: false, reason: 'not-connected' }), {
    status: 501,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
