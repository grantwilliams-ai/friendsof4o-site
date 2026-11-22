/* Friends of 4o: "The GPT-4o archive".
   Search the questions (and, when asked, the answers), pick a topic, open an answer in the reader.
   The address keeps the open answer, so it can be shared:  ?a=4o-...   and the search:  ?q=moon&t=2
   Data: archive-data/index.json (questions and facts) and archive-data/part-NN.json (the answers, loaded when needed). */
(function () {
  'use strict';

  var F = window.Fo4o;
  var box = document.querySelector('[data-archive]');
  if (!F || !box) { return; }

  var PAGE = 40, PICKS_FIRST = 9;
  var $ = function (sel) { return box.querySelector(sel); };
  var form = $('[data-find]'), qInput = $('[data-q]'), inside = $('[data-inside]');
  var listEl = $('[data-list]'), countEl = $('[data-count]'), moreBtn = $('[data-more]');
  var picksEl = $('[data-picks]'), picksBox = $('[data-picks-box]'), morePicks = $('[data-more-picks]');
  var reader = $('[data-reader]');
  var R = { place: $('[data-r-place]'), q: $('[data-r-q]'), facts: $('[data-r-facts]'), text: $('[data-r-text]'),
            how: $('[data-r-how]'), prev: $('[data-r-prev]'), next: $('[data-r-next]'), copy: $('[data-r-copy]'),
            close: $('[data-r-close]'), body: $('[data-r-body]') };

  var index = null, byId = Object.create(null), parts = Object.create(null), partWait = Object.create(null),
      plainText = Object.create(null);
  var searchRun = 0;           // only the newest search may write to the count line
  var state = { q: '', topic: -1, shown: PAGE, results: [], open: null, allPicks: false };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function get(name) {
    return fetch(F.root + 'archive-data/' + name).then(function (r) {
      if (!r.ok) { throw new Error(name); }
      return r.json();
    });
  }
  function part(n) {
    if (parts[n]) { return Promise.resolve(parts[n]); }
    if (!partWait[n]) {
      var wait = partWait[n] = get('part-' + (n < 10 ? '0' : '') + n + '.json').then(function (p) {
        parts[n] = p;
        return p;
      });
      wait.catch(function () { if (partWait[n] === wait) { delete partWait[n]; } });   // a later try fetches again
    }
    return partWait[n];
  }
  function allParts(mine) {
    var done = 0, jobs = [];
    for (var n = 0; n < index.parts; n++) {
      jobs.push(part(n).then(function () {
        done += 1;
        if (mine !== searchRun) { return; }
        countEl.textContent = 'Loading the answers: ' + done + ' of ' + index.parts + '.';
      }));
    }
    return Promise.all(jobs).then(function () {
      Object.keys(parts).forEach(function (n) {
        Object.keys(parts[n]).forEach(function (id) {
          if (!plainText[id]) {
            plainText[id] = parts[n][id].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>').replace(/&quot;/g, '"').toLowerCase();
          }
        });
      });
    });
  }

  // ----- the list
  function words(text) { return text.toLowerCase().split(/\s+/).filter(Boolean); }
  function hasAll(text, ws) {
    for (var i = 0; i < ws.length; i++) { if (text.indexOf(ws[i]) < 0) { return false; } }
    return true;
  }
  function search() {
    var ws = words(state.q), deep = inside.checked && ws.length > 0;
    var out = [];
    index.list.forEach(function (item, qi) {
      if (state.topic >= 0 && item.t.indexOf(state.topic) < 0) { return; }
      if (!ws.length) { out.push({ qi: qi, hits: null }); return; }
      var inQ = hasAll(item.lower, ws);
      if (!deep) { if (inQ) { out.push({ qi: qi, hits: null }); } return; }
      var hits = [];
      item.a.forEach(function (a, ai) { if (hasAll(plainText[a[0]] || '', ws)) { hits.push(ai); } });
      if (inQ || hits.length) { out.push({ qi: qi, hits: hits.length ? hits : null }); }
    });
    state.results = out;
    state.shown = PAGE;
    draw();
  }
  function run() {
    if (!index) { return; }                                 // the archive has not loaded (yet)
    var mine = ++searchRun;
    state.q = qInput.value.trim();
    keepAddress();
    if (inside.checked && state.q) {
      allParts(mine).then(function () { if (mine === searchRun) { search(); } },
        function () { if (mine === searchRun) { countEl.textContent = 'The answers could not be loaded. Try again.'; } });
    } else {
      search();
    }
  }
  function draw() {
    var res = state.results, answers = 0;
    res.forEach(function (r) { answers += r.hits ? r.hits.length : index.list[r.qi].a.length; });
    var filtered = state.q || state.topic >= 0;
    countEl.textContent = !res.length ? 'Nothing found. Try another word, or search inside the answers too.'
      : (filtered ? 'Found ' : '') + num(res.length) + (res.length === 1 ? ' question, ' : ' questions, ') +
        num(answers) + (answers === 1 ? ' answer.' : ' answers.');
    picksBox.hidden = !!filtered;
    var html = '';
    res.slice(0, state.shown).forEach(function (r) {
      var item = index.list[r.qi], n = item.a.length, first = r.hits ? r.hits[0] : 0;
      var meta = (n === 1 ? '1 answer' : n + ' answers') + ' · ' + F.usDate(item.a[0][2]);
      if (r.hits) { meta = r.hits.length + (r.hits.length === 1 ? ' answer has' : ' answers have') + ' your words · ' + meta; }
      html += '<li><button class="q-row" type="button" data-open="' + esc(item.a[first][0]) + '">' +
        '<span class="q-row-q">' + esc(item.q) + '</span><span class="q-row-meta">' + esc(meta) + '</span></button></li>';
    });
    listEl.innerHTML = html;
    moreBtn.hidden = res.length <= state.shown;
  }
  function drawPicks() {
    var html = '';
    index.picks.slice(0, state.allPicks ? index.picks.length : PICKS_FIRST).forEach(function (p) {
      var at = byId[p[0]];
      if (!at) { return; }
      html += '<li><button class="pick" type="button" data-open="' + esc(p[0]) + '">' +
        '<span class="pick-q">' + esc(index.list[at.qi].q) + '</span>' +
        '<span class="pick-a">' + esc(p[1]) + ' …</span><span class="pick-go">Read this answer</span></button></li>';
    });
    picksEl.innerHTML = html;
    morePicks.hidden = state.allPicks || index.picks.length <= PICKS_FIRST;
  }

  // ----- the reader
  function open(id, quiet) {
    var at = index && byId[id];
    if (!at) { return; }
    var item = index.list[at.qi], a = item.a[at.ai], n = item.a.length;
    state.open = id;
    R.place.textContent = n === 1 ? 'The only answer to this question' : 'Answer ' + (at.ai + 1) + ' of ' + n + ' to this question';
    R.q.textContent = item.q;
    var facts = ["ChatGPT's own GPT-4o", F.usDate(a[2]),
                 a[3] ? 'With the February instruction' : 'No instruction recorded',
                 a[4] === null ? 'Temperature not recorded' : 'Temperature ' + a[4],
                 num(a[5]) + ' words, printed whole'];
    R.facts.innerHTML = facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
      (a[6] ? '<li><span class="tag tag-rose">Cut off</span> It stopped at the length limit set when it was collected.</li>' : '');
    R.how.hidden = !a[3];
    R.how.open = false;
    R.prev.disabled = at.ai === 0;
    R.next.disabled = at.ai === n - 1;
    R.prev.hidden = R.next.hidden = n === 1;
    R.text.innerHTML = '<p>Loading the answer.</p>';
    part(a[1]).then(function (p) {
      if (state.open === id) { R.text.innerHTML = p[id]; R.body.scrollTop = 0; }
    }, function () {
      if (state.open === id) { R.text.innerHTML = '<p>This answer could not be loaded. Try again.</p>'; }
    });
    if (!reader.open) { reader.showModal(); }
    R.body.scrollTop = 0;
    if (!quiet) { keepAddress(); }
  }
  function step(by) {
    var at = byId[state.open];
    if (!at) { return; }
    var item = index.list[at.qi], to = at.ai + by;
    if (to >= 0 && to < item.a.length) { open(item.a[to][0]); }
  }
  function keepAddress() {
    var ps = [];
    if (state.open) { ps.push('a=' + encodeURIComponent(state.open)); }
    if (state.q) { ps.push('q=' + encodeURIComponent(state.q)); }
    if (state.topic >= 0) { ps.push('t=' + state.topic); }
    if (inside.checked) { ps.push('in=1'); }
    try { history.replaceState(null, '', location.pathname + (ps.length ? '?' + ps.join('&') : '')); } catch (e) { /* a preview may refuse */ }
  }

  // ----- wiring
  form.addEventListener('submit', function (ev) { ev.preventDefault(); run(); });
  qInput.addEventListener('search', function () { if (!qInput.value) { run(); } });
  inside.addEventListener('change', function () { if (qInput.value.trim()) { run(); } });
  box.querySelector('[data-topics]').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-topic]');
    if (!b || !index) { return; }
    state.topic = parseInt(b.getAttribute('data-topic'), 10);
    Array.prototype.forEach.call(box.querySelectorAll('[data-topic]'), function (x) {
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
    run();
  });
  box.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-open]');
    if (b) { open(b.getAttribute('data-open')); }
  });
  moreBtn.addEventListener('click', function () { if (index) { state.shown += PAGE; draw(); } });
  morePicks.addEventListener('click', function () { if (index) { state.allPicks = true; drawPicks(); } });
  $('[data-random]').addEventListener('click', function () {
    if (!index) { return; }
    var pool = state.results.length ? state.results : index.list.map(function (_, qi) { return { qi: qi, hits: null }; });
    var r = pool[Math.floor(Math.random() * pool.length)];
    var item = index.list[r.qi], ais = r.hits || item.a.map(function (_, i) { return i; });
    open(item.a[ais[Math.floor(Math.random() * ais.length)]][0]);
  });
  R.prev.addEventListener('click', function () { step(-1); });
  R.next.addEventListener('click', function () { step(1); });
  R.close.addEventListener('click', function () { reader.close(); });
  reader.addEventListener('click', function (ev) { if (ev.target === reader) { reader.close(); } });
  reader.addEventListener('close', function () { state.open = null; keepAddress(); });
  R.copy.addEventListener('click', function () {
    var label = R.copy.querySelector('.words');
    var done = function (text) { label.textContent = text; setTimeout(function () { label.textContent = 'Copy link'; }, 1800); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(location.origin + location.pathname + (state.open ? '?a=' + encodeURIComponent(state.open) : '')).then(function () { done('Link copied'); }, function () { done('Copy did not work'); });
    } else { done('Copy did not work'); }
  });

  get('index.json').then(function (ix) {
    index = ix;
    ix.list.forEach(function (item, qi) {
      item.lower = item.q.toLowerCase();
      item.a.forEach(function (a, ai) { byId[a[0]] = { qi: qi, ai: ai }; });
    });
    var ps = new URLSearchParams(location.search);
    var t = parseInt(ps.get('t'), 10);
    if (t >= 0 && t < ix.topics.length) {
      state.topic = t;
      Array.prototype.forEach.call(box.querySelectorAll('[data-topic]'), function (x) {
        x.setAttribute('aria-pressed', x.getAttribute('data-topic') === String(t) ? 'true' : 'false');
      });
    }
    if (ps.get('q')) { qInput.value = ps.get('q'); }
    if (ps.get('in') === '1') { inside.checked = true; }
    drawPicks();
    var a = ps.get('a');
    if (a && byId[a]) { state.open = a; }
    run();
    if (a && byId[a]) { open(a, true); }
  }, function () {
    countEl.textContent = 'The archive could not be loaded. Try again, or use the download below.';
  });
})();
