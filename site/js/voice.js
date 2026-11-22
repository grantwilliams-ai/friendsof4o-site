/* Friends of 4o: "GPT-4o in everyday moments" (first named "GPT-4o voice samples"). Pick a moment, a version, a way of asking and a try; read the replies.
   The address keeps the view:  ?m=s04&v=4o-nov&w=plain&t=1
   Data: voice-data/index.json (the moments) and voice-data/<id>.json (every reply to one moment).
   Each choice (moment, version, way of asking, try) is a step that Back undoes, back to no moment open; a shared
   link opens straight at its replies, and Back from there leaves the page as usual. */
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
  // entry: 'push' (a choice made here: Back undoes it), 'replace', or 'none' (the address is already right)
  function keep(how) {
    var to = location.pathname + (state.m ? '?m=' + state.m + '&v=' + state.v + '&w=' + state.w + '&t=' + state.t : '');
    try {
      if (how === 'push' && to !== location.pathname + location.search) { history.pushState(null, '', to); }
      else if (how !== 'none') { history.replaceState(null, '', to); }
    } catch (e) { /* a preview may refuse */ }
  }
  function show(scroll, entry) {
    var m = moment(state.m);
    press('data-pick', state.m);
    if (!m) { view.hidden = true; keep(entry); return; }
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
        Array.prototype.forEach.call(turnsEl.querySelectorAll('.turn-4o .answer-text'), function (t) { fitAnswer(t, 3); });
        factsEl.textContent = label(index.versions, state.v) + ' version · ' + label(index.ways, state.w) + ' · try ' + state.t +
          ' of 5 · ' + F.usDate(run.asked) + ' · ' + words + ' words in all, printed whole';
      }).catch(function () {
        if (!still()) { return; }                                 // the reader has moved on
        turnsEl.innerHTML = '<p class="arch-count">The replies could not be loaded. Try again.</p>';
      });
    keep(entry);
    if (scroll) {
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      view.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
  }
  box.addEventListener('click', function (ev) {
    // "Pick another moment": back up to the list, on the moment that is open now (the replies stay as they are)
    if (ev.target.closest('[data-back-list]')) {
      var on = listEl.querySelector('[aria-pressed="true"]') || listEl.querySelector('[data-pick]');
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      (listEl.closest('section') || listEl).scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      if (on) { on.focus({ preventScroll: true }); }
      return;
    }
    var b = ev.target.closest('[data-pick],[data-v],[data-w],[data-t],[data-next]');
    if (!b) { return; }
    if (b.hasAttribute('data-pick')) { state.m = b.getAttribute('data-pick'); show(true, 'push'); return; }
    if (b.hasAttribute('data-v')) { state.v = b.getAttribute('data-v'); }
    if (b.hasAttribute('data-w')) { state.w = b.getAttribute('data-w'); }
    if (b.hasAttribute('data-t')) { state.t = parseInt(b.getAttribute('data-t'), 10); }
    if (b.hasAttribute('data-next')) { state.t = state.t % 5 + 1; }
    show(false, 'push');
  });
  // the view the address names; with no moment named, none is open
  function fromAddress() {
    var ps = new URLSearchParams(location.search);
    state = { m: null, v: '4o-nov', w: 'plain', t: 1 };
    if (!moment(ps.get('m'))) { return false; }
    state.m = ps.get('m');
    if (label(index.versions, ps.get('v'))) { state.v = ps.get('v'); }
    if (label(index.ways, ps.get('w'))) { state.w = ps.get('w'); }
    var t = parseInt(ps.get('t'), 10);
    if (t >= 1 && t <= 5) { state.t = t; }
    return true;
  }
  window.addEventListener('popstate', function () {
    if (!index) { return; }
    fromAddress();
    show(false, 'none');
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
    if (fromAddress()) { show(true, 'replace'); }             // an address that names a moment opens at its replies
  }, function () { listEl.innerHTML = '<li class="arch-count">The samples could not be loaded. Try again, or use the download below.</li>'; });
})();
