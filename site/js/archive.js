/* Friends of 4o: "The GPT-4o archive".
   Search the questions (and, when asked, the answers), pick a topic, open an answer in the reader.
   The address keeps the open answer, so it can be shared:  ?a=4o-...   and the search:  ?q=dream&t=2
   Back in the browser closes an open answer, then steps back through the searches and topics chosen here; a
   shared link opens straight at its answer, and Back from there leaves the page as usual.
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
  var reader = $('[data-reader]'), listH = $('#list-h'), randomBtn = $('[data-random]');
  var R = { place: $('[data-r-place]'), q: $('[data-r-q]'), facts: $('[data-r-facts]'), text: $('[data-r-text]'),
            how: $('[data-r-how]'), prev: $('[data-r-prev]'), next: $('[data-r-next]'), copy: $('[data-r-copy]'),
            close: $('[data-r-close]'), body: $('[data-r-body]'), qmore: $('[data-r-qmore]') };

  var index = null, byId = Object.create(null), parts = Object.create(null), partWait = Object.create(null),
      plainText = Object.create(null);
  var searchRun = 0;           // only the newest search may write to the count line
  var state = { q: '', topic: -1, shown: PAGE, results: [], open: null, allPicks: false };
  var closingFromHistory = false;  // the reader is being closed by Back, so the address is already right
  var scrollToList = false;        // the page was opened with a search or a topic (from the home page): show the results

  // An answer keeps its own words. On this page its own headings sit one level under the heading above it, in the
  // same order, and contents links that point to no place in the answer are shown as plain text.
  function fitAnswer(node, top) {
    var hs = node.querySelectorAll('h1, h2, h3, h4, h5, h6'), levels = [], i, k;
    for (i = 0; i < hs.length; i++) {
      var l = Number(hs[i].tagName.charAt(1));
      if (levels.indexOf(l) < 0) { levels.push(l); }
    }
    levels.sort();
    for (i = 0; i < hs.length; i++) {
      var h = hs[i], to = Math.min(6, top + levels.indexOf(Number(h.tagName.charAt(1))));
      if (h.tagName === 'H' + to) { continue; }
      var n = document.createElement('h' + to);
      for (k = 0; k < h.attributes.length; k++) { n.setAttribute(h.attributes[k].name, h.attributes[k].value); }
      while (h.firstChild) { n.appendChild(h.firstChild); }
      h.parentNode.replaceChild(n, h);
    }
    var links = node.querySelectorAll('a[href^="#"]'), ids = node.querySelectorAll('[id]');
    for (i = 0; i < links.length; i++) {
      var a = links[i], want = a.getAttribute('href').slice(1), found = false;
      for (k = 0; k < ids.length; k++) { if (want && ids[k].id === want) { found = true; } }
      if (found) { continue; }
      var span = document.createElement('span');
      while (a.firstChild) { span.appendChild(a.firstChild); }
      a.parentNode.replaceChild(span, a);
    }
  }

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
    if (state.open) { drawPlace(); }
    if (scrollToList) {
      scrollToList = false;
      listEl.closest('section').scrollIntoView({ block: 'start' });
    }
  }
  // how: 'push' (a new search the reader chose: Back undoes it), 'replace', or 'none' (the address is already right)
  function run(how) {
    if (!index) { return; }                                 // the archive has not loaded (yet)
    var mine = ++searchRun;
    state.q = qInput.value.trim();
    if (how !== 'none') { keepAddress(how); }
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
    listH.textContent = filtered ? 'Results' : 'All questions';
    randomBtn.disabled = !!filtered && !res.length;
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
    moreBtn.querySelector('.words').textContent = 'Show more questions (' + num(Math.min(state.shown, res.length)) + ' of ' +
      num(res.length) + ' shown)';
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
  // After a search inside the answers, the answers to this question that have the words; otherwise null.
  function matches(at) {
    if (!state.q || !inside.checked) { return null; }
    for (var i = 0; i < state.results.length; i++) {
      if (state.results[i].qi === at.qi) { return state.results[i].hits; }
    }
    return null;
  }
  // The answers Previous and Next step through: the matches after a search inside the answers, otherwise all of them.
  function neighbour(at, by) {
    var item = index.list[at.qi], hits = matches(at), to = at.ai + by;
    if (hits) {
      to = -1;
      for (var i = 0; i < hits.length; i++) {
        if (by > 0 && hits[i] > at.ai) { to = hits[i]; break; }
        if (by < 0 && hits[i] < at.ai) { to = hits[i]; }
      }
    }
    return to >= 0 && to < item.a.length ? to : -1;
  }
  function drawPlace() {
    var at = byId[state.open];
    if (!at) { return; }
    var n = index.list[at.qi].a.length, hits = matches(at);
    var place = n === 1 ? 'The only answer to this question' : 'Answer ' + (at.ai + 1) + ' of ' + n + ' to this question';
    if (hits && hits.length < n && hits.indexOf(at.ai) >= 0) {
      place += ' · ' + (hits.indexOf(at.ai) + 1) + ' of ' + hits.length + ' with your words';
    }
    R.place.textContent = place;
    R.prev.disabled = neighbour(at, -1) < 0;
    R.next.disabled = neighbour(at, 1) < 0;
    R.prev.hidden = R.next.hidden = n === 1 || (!!hits && hits.length === 1 && hits[0] === at.ai);
  }
  // A long question is shown on three lines, with a button to show it whole, so the answer starts on the first screen.
  function fitQuestion() {
    R.q.classList.add('q-short');
    R.qmore.hidden = R.q.scrollHeight <= R.q.clientHeight + 2;
    R.qmore.setAttribute('aria-expanded', 'false');
    R.qmore.querySelector('.words').textContent = 'Show the whole question';
  }
  // how: 'push' (opened from the list: Back closes it), 'replace' (Previous or Next), 'none' (the address names it)
  function open(id, how) {
    var at = index && byId[id];
    if (!at) { return; }
    var item = index.list[at.qi], a = item.a[at.ai];
    state.open = id;
    R.q.textContent = item.q;
    R.q.classList.toggle('q-long', item.q.length > 150);
    var facts = ["ChatGPT's own GPT-4o", F.usDate(a[2]),
                 a[3] ? 'With the February instruction' : 'No instruction recorded',
                 a[4] === null ? 'Temperature not recorded' : 'Temperature ' + a[4],
                 num(a[5]) + ' words, printed whole'];
    R.facts.innerHTML = facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
      (a[6] ? '<li><span class="tag tag-rose">Cut off</span> It stopped at the length limit set when it was collected.</li>' : '');
    R.how.hidden = !a[3];
    R.how.open = false;
    drawPlace();
    R.text.innerHTML = '<p>Loading the answer.</p>';
    part(a[1]).then(function (p) {
      if (state.open === id) { R.text.innerHTML = p[id]; fitAnswer(R.text, 3); R.body.scrollTop = 0; }
    }, function () {
      if (state.open === id) { R.text.innerHTML = '<p>This answer could not be loaded. Try again.</p>'; }
    });
    var wasOpen = reader.open;
    if (!wasOpen) { reader.showModal(); }
    fitQuestion();
    R.body.scrollTop = 0;
    if (how === 'none') { return; }
    keepAddress(wasOpen ? 'replace' : how, wasOpen ? history.state : { reader: 1 });
  }
  function step(by) {
    var at = byId[state.open];
    if (!at) { return; }
    var to = neighbour(at, by);
    if (to >= 0) { open(index.list[at.qi].a[to][0], 'replace'); }
  }
  function keepAddress(how, mark) {
    var ps = [];
    if (state.open) { ps.push('a=' + encodeURIComponent(state.open)); }
    if (state.q) { ps.push('q=' + encodeURIComponent(state.q)); }
    if (state.topic >= 0) { ps.push('t=' + state.topic); }
    if (inside.checked) { ps.push('in=1'); }
    var to = location.pathname + (ps.length ? '?' + ps.join('&') : '');
    try {
      if (how === 'push' && to !== location.pathname + location.search) { history.pushState(mark || null, '', to); }
      else { history.replaceState(how === 'push' ? mark || null : history.state, '', to); }
    } catch (e) { /* a preview may refuse */ }
  }
  function pressTopic(t) {
    Array.prototype.forEach.call(box.querySelectorAll('[data-topic]'), function (x) {
      x.setAttribute('aria-pressed', x.getAttribute('data-topic') === String(t) ? 'true' : 'false');
    });
  }

  // ----- wiring
  form.addEventListener('submit', function (ev) { ev.preventDefault(); run('push'); });
  qInput.addEventListener('search', function () { if (!qInput.value) { run('push'); } });
  inside.addEventListener('change', function () { if (qInput.value.trim()) { run('push'); } else { keepAddress('replace'); } });
  box.querySelector('[data-topics]').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-topic]');
    if (!b || !index) { return; }
    state.topic = parseInt(b.getAttribute('data-topic'), 10);
    pressTopic(state.topic);
    run('push');
  });
  box.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-open]');
    if (b) { open(b.getAttribute('data-open'), 'push'); }
  });
  moreBtn.addEventListener('click', function () { if (index) { state.shown += PAGE; draw(); } });
  morePicks.addEventListener('click', function () { if (index) { state.allPicks = true; drawPicks(); } });
  // Every answer that is listed has the same chance: after a search, every answer that matched; otherwise all of them.
  randomBtn.addEventListener('click', function () {
    if (!index) { return; }
    var pool = state.results.length || state.q || state.topic >= 0 ? state.results
      : index.list.map(function (_, qi) { return { qi: qi, hits: null }; });
    var total = 0;
    pool.forEach(function (r) { total += r.hits ? r.hits.length : index.list[r.qi].a.length; });
    if (!total) { return; }
    var k = Math.floor(Math.random() * total);
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i], ais = r.hits || null, n = ais ? ais.length : index.list[r.qi].a.length;
      if (k < n) { open(index.list[r.qi].a[ais ? ais[k] : k][0], 'push'); return; }
      k -= n;
    }
  });
  R.prev.addEventListener('click', function () { step(-1); });
  R.next.addEventListener('click', function () { step(1); });
  R.close.addEventListener('click', function () { reader.close(); });
  R.qmore.addEventListener('click', function () {
    var whole = R.q.classList.toggle('q-short') === false;
    R.qmore.setAttribute('aria-expanded', whole ? 'true' : 'false');
    R.qmore.querySelector('.words').textContent = whole ? 'Show less of the question' : 'Show the whole question';
  });
  reader.addEventListener('click', function (ev) { if (ev.target === reader) { reader.close(); } });
  reader.addEventListener('close', function () {
    state.open = null;
    if (closingFromHistory) { closingFromHistory = false; return; }
    // opened from the list here: step back over its own entry, so Back is not needed twice
    if (history.state && history.state.reader) { history.back(); } else { keepAddress('replace'); }
  });
  // Back and Forward: show what the address names, without writing a new entry
  window.addEventListener('popstate', function () {
    if (!index) { return; }
    var ps = new URLSearchParams(location.search);
    var q = ps.get('q') || '', t = parseInt(ps.get('t'), 10), ins = ps.get('in') === '1', a = ps.get('a');
    if (!(t >= 0 && t < index.topics.length)) { t = -1; }
    var changed = q !== state.q || t !== state.topic || ins !== inside.checked;
    qInput.value = q;
    inside.checked = ins;
    state.topic = t;
    pressTopic(t);
    if (changed) { run('none'); }
    if (a && byId[a]) {
      if (state.open !== a) { open(a, 'none'); }
    } else if (reader.open) {
      closingFromHistory = true;
      reader.close();
    }
  });
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
      pressTopic(t);
    }
    if (ps.get('q')) { qInput.value = ps.get('q'); }
    if (ps.get('in') === '1') { inside.checked = true; }
    drawPicks();
    var a = ps.get('a');
    if (a && byId[a]) { state.open = a; }
    scrollToList = !state.open && (!!ps.get('q') || state.topic >= 0);
    run('replace');
    if (a && byId[a]) { open(a, 'none'); }
  }, function () {
    countEl.textContent = 'The archive could not be loaded. Try again, or use the download below.';
  });
})();
