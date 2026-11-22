/* Friends of 4o: "GPT-4o in everyday moments" (first named "GPT-4o voice samples"). Pick a moment, a version, a way of asking and a try; read the replies.
   The address keeps the view:  ?m=s04&v=4o-nov&w=plain&t=1
   Data: voice-data/index.json (the moments) and voice-data/<id>.json (every reply to one moment). */
(function () {
  'use strict';
  var F = window.Fo4o;
  var box = document.querySelector('[data-voice]');
  if (!F || !box) { return; }
  var $ = function (s) { return box.querySelector(s); };
  var listEl = $('[data-moments]'), view = $('[data-view]'), turnsEl = $('[data-turns]'), titleEl = $('[data-title]'),
      factsEl = $('[data-facts]'), how = $('[data-how]');
  var index = null, cache = {}, state = { m: null, v: '4o-nov', w: 'plain', t: 1 };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function get(name) {
    return fetch(F.root + 'voice-data/' + name).then(function (r) { if (!r.ok) { throw new Error(name); } return r.json(); });
  }
  function moment(id) { for (var i = 0; i < index.moments.length; i++) { if (index.moments[i].id === id) { return index.moments[i]; } } return null; }
  function label(pairs, key) { for (var i = 0; i < pairs.length; i++) { if (pairs[i][0] === key) { return pairs[i][1]; } } return ''; }
  function press(attr, value) {
    Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute(attr) === String(value) ? 'true' : 'false');
    });
  }
  function keep() {
    var q = state.m ? '?m=' + state.m + '&v=' + state.v + '&w=' + state.w + '&t=' + state.t : '';
    try { history.replaceState(null, '', location.pathname + q); } catch (e) { /* a preview may refuse */ }
  }
  function show(scroll) {
    var m = moment(state.m);
    if (!m) { view.hidden = true; return; }
    view.hidden = false;
    press('data-pick', state.m); press('data-v', state.v); press('data-w', state.w); press('data-t', state.t);
    titleEl.textContent = m.kind === 'conversation' ? m.title : 'One message';
    how.hidden = state.w !== 'instructionA';
    turnsEl.innerHTML = '<p class="arch-count">Loading the replies.</p>';
    var want = state.m + '|' + state.v + '|' + state.w + '|' + state.t;
    var still = function () { return want === state.m + '|' + state.v + '|' + state.w + '|' + state.t; };
    (cache[m.id] ? Promise.resolve(cache[m.id]) : get(m.id + '.json').then(function (d) { cache[m.id] = d; return d; }))
      .then(function (d) {
        if (!still()) { return; }
        var run = d[state.v + '|' + state.w + '|' + state.t], html = '', words = 0;
        m.lines.forEach(function (line, i) {
          var r = run.replies[i];
          words += r.words;
          html += '<article class="turn turn-grant"><p class="turn-who"><strong>The person</strong> <span>a line written for this test</span></p>' +
            '<div class="answer-text"><p>' + esc(line) + '</p></div></article>' +
            '<article class="turn turn-4o"><p class="turn-who"><strong>GPT-4o</strong> <span>' + esc(label(index.versions, state.v)) +
            ' version · ' + r.words + ' words</span></p><div class="answer-text">' + r.html + '</div></article>';
        });
        turnsEl.innerHTML = html;
        factsEl.textContent = label(index.versions, state.v) + ' version · ' + label(index.ways, state.w) + ' · try ' + state.t +
          ' of 5 · ' + F.usDate(run.asked) + ' · ' + words + ' words in all, printed whole';
      }).catch(function () {
        if (!still()) { return; }                                 // the reader has moved on
        turnsEl.innerHTML = '<p class="arch-count">The replies could not be loaded. Try again.</p>';
      });
    keep();
    if (scroll) {
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      view.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
  }
  box.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-pick],[data-v],[data-w],[data-t],[data-next]');
    if (!b) { return; }
    if (b.hasAttribute('data-pick')) { state.m = b.getAttribute('data-pick'); show(true); return; }
    if (b.hasAttribute('data-v')) { state.v = b.getAttribute('data-v'); }
    if (b.hasAttribute('data-w')) { state.w = b.getAttribute('data-w'); }
    if (b.hasAttribute('data-t')) { state.t = parseInt(b.getAttribute('data-t'), 10); }
    if (b.hasAttribute('data-next')) { state.t = state.t % 5 + 1; }
    show(false);
  });
  get('index.json').then(function (ix) {
    index = ix;
    var html = '';
    ix.moments.forEach(function (m) {
      html += '<li><button class="pick" type="button" data-pick="' + m.id + '" aria-pressed="false">' +
        '<span class="pick-go">' + (m.kind === 'conversation' ? 'Conversation · ' + m.lines.length + ' turns' : 'One message') + '</span>' +
        '<span class="pick-q">' + esc(m.kind === 'conversation' ? m.title : m.lines[0]) + '</span>' +
        (m.kind === 'conversation' ? '<span class="pick-a">' + esc(m.lines[0]) + '</span>' : '') + '</button></li>';
    });
    listEl.innerHTML = html;
    var ps = new URLSearchParams(location.search);
    if (moment(ps.get('m'))) {
      state.m = ps.get('m');
      if (label(ix.versions, ps.get('v'))) { state.v = ps.get('v'); }
      if (label(ix.ways, ps.get('w'))) { state.w = ps.get('w'); }
      var t = parseInt(ps.get('t'), 10);
      if (t >= 1 && t <= 5) { state.t = t; }
      show(true);                                             // an address that names a moment opens at its replies
    }
  }, function () { listEl.innerHTML = '<li class="arch-count">The samples could not be loaded. Try again, or use the download below.</li>'; });
})();
