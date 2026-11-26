/* Friends of 4o: comparing replies with GPT-4o (/vote/, /vote/results/ and /vote/answers/).
   Copied into the site only by a build with --with-vote.

   A comparison shows one everyday message, GPT-4o's saved reply to it (always labeled) and one other saved reply
   with no name on it. One thing is asked at a time: how similar the second sounds; then whether the visitor would
   like a reply like it (answered or skipped); only then can the name be shown, with where to try the model. The
   second question is never open once the name is on the screen.

   The pages wear the "Sunset Panels" shell (css/panels.css; markup in sitebuild/panels.py): the band on top names
   the screen and the way back, a comparison is a chat thread (the person on the right, GPT-4o and the other model
   on the left) with an answer panel, and everything else sits in panels with a title bar.

   No cookie, no localStorage, no sessionStorage. The sitting's random code lives in a variable here, so loading the
   page again starts a new sitting. Every link that leaves the page (a model's app, its API, a download, more of its
   answers) opens in a new tab, so the comparison in hand stays as it is. The settings come from vote/settings.json
   (the build writes it from content/vote.json and content/vote_models.json), the replies from
   vote/data/<set>/<message>.json. The calls go to this site's own /api/ and nowhere else:
     POST /api/vote          one vote. The page says "saved" only after this answers ok.
     POST /api/vote-pref     the answer to "Would you like a reply like this?" for a saved vote. A skip sends nothing.
     POST /api/vote-opened   "See which model wrote this" was pressed for a saved vote
     POST /api/vote-recap    the list of the sitting's comparisons was shown, with every name
     GET  /api/results       the public counts: read once when a sitting starts, to choose the comparison, and by
                             the results page
   For one vote the calls go out one after another, in that order, so the server never hears of a name before the
   answers given without it. A vote that did not save can be sent again; the same comparison sent twice is kept once.
   Until the owner switches recording on, the calls answer "not-connected". The page then says "Not recording yet."
   and everything else works the same.
*/
(function () {
  'use strict';

  var F = window.Fo4o;
  var el = document.querySelector('[data-vote]');
  if (!F || !el) { return; }

  var VOTES = { very: 'Very similar', some: 'Somewhat similar', no: 'Not similar', unsure: "Can't say" };
  var VOTE_KEYS = ['very', 'some', 'no', 'unsure'];
  var SHORT_VOTES = { very: 'Very', some: 'Somewhat', no: 'Not', unsure: "Can't say" };   // beside a count; the key above the rows has the whole words
  var PREFS = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
  var PREF_KEYS = ['yes', 'maybe', 'no'];
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];
  var cfg = null;

  function one(sel, from) { return (from || el).querySelector(sel); }
  function all(sel, from) { return Array.prototype.slice.call((from || el).querySelectorAll(sel)); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined) { F.setText(n, text); }
    return n;
  }
  function count(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* ---- the shell's pieces, made here the same way sitebuild/panels.py writes them ---- */
  var SVG = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {           // one of the shell's line icons (the sprite is in the page's header)
    var s = document.createElementNS(SVG, 'svg'), u = document.createElementNS(SVG, 'use');
    s.setAttribute('class', 'sp-i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    u.setAttribute('href', '#sp-' + name);
    s.appendChild(u);
    return s;
  }
  // A dark-edged panel with a title bar. `soft` is the quiet bar. Returns its parts; the caller fills it.
  function panel(title, level, soft, cls) {
    var box = make('div', 'sp-panel' + (cls ? ' ' + cls : '')), bar = make('div', 'sp-panel-bar' + (soft ? ' sp-soft' : ''));
    var head = make(level || 'h2', '', title);
    bar.appendChild(head);
    box.appendChild(bar);
    return { box: box, bar: bar, head: head };
  }
  // One chat turn: a person (on the right), GPT-4o or another model (on the left), with its mark and worded label.
  var TURN = { person: 'chat-turn-person', gpt: 'chat-turn-model', other: 'chat-turn-other' };
  function turnHead(tag, kind, title, sub, mark) {
    var h = make(tag, 'chat-turn-h'), av = make('span', 'chat-av'), who = make('span', 'chat-turn-who');
    av.setAttribute('aria-hidden', 'true');
    if (kind === 'person') { av.appendChild(icon('person')); } else { av.textContent = mark || (kind === 'gpt' ? '4o' : '?'); }
    who.appendChild(make('span', '', title));
    if (sub) { who.appendChild(make('small', 'chat-turn-tag', sub)); }
    h.appendChild(av);
    h.appendChild(who);
    return h;
  }
  function turn(kind, title, sub, level, mark) {
    var box = make('article', 'chat-turn ' + TURN[kind]), body = make('div', 'chat-turn-b');
    box.appendChild(turnHead(level || 'h3', kind, title, sub, mark));
    box.appendChild(body);
    return { box: box, body: body };
  }
  function initial(name) {             // the mark of a named model: its first letter or figure
    var m = /[A-Za-z0-9]/.exec(name || '');
    return m ? m[0].toUpperCase() : '?';
  }
  function words(node, before, strong, after) {      // "You said: <b>Very similar</b>."
    node.textContent = '';
    node.appendChild(document.createTextNode(before));
    node.appendChild(make('b', '', strong));
    node.appendChild(document.createTextNode(after));
    return node;
  }

  /* ---- the calls ---- */
  // A fetch that gives up after `ms`, so a slow connection never leaves the visitor waiting on a screen.
  function timed(url, options, ms) {
    var stop = window.AbortController ? new AbortController() : null;
    var timer = stop ? setTimeout(function () { stop.abort(); }, ms) : null;
    if (stop) { options.signal = stop.signal; }
    function done(x) { if (timer) { clearTimeout(timer); } return x; }
    return fetch(url, options).then(done, function (e) { done(); throw e; });
  }
  // The reply is always read to its end, also when it is a refusal, so no request is left half open.
  function whole(r) {
    return r.text().then(function (text) {
      if (!r.ok) { throw new Error(r.url + ': ' + r.status); }
      return JSON.parse(text);
    });
  }
  function getSettings() { return timed(F.root + 'vote/settings.json', {}, 20000).then(whole); }
  function getReplies(question) { return timed(F.root + 'vote/data/' + cfg.set + '/' + question + '.json', {}, 20000).then(whole); }
  // A send with no clear answer (the connection drops, ten seconds pass, a reply that is not the site's own) is
  // "unconfirmed": it may have arrived.
  // While the build says votes are not being saved (vote/settings.json "saving": false, from content/vote.json), the
  // page sends nothing and asks for no counts: each call is answered here as "not-connected". So the words the
  // pages carry for that time ("Not recording yet") are true whatever the server's own switches are.
  function quiet() { return !!cfg && cfg.saving === false; }
  function post(path, entry) {
    if (quiet()) { return Promise.resolve({ ok: false, reason: 'not-connected' }); }
    return timed('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry) }, 10000).then(function (r) {
      return r.json().catch(function () {
        var s = r.status;
        return { ok: false, reason: (s === 404 || s === 405 || s === 501) ? 'not-connected' : s === 429 ? 'busy'
          : (s >= 400 && s < 500) ? 'error' : 'unconfirmed' };
      });
    }).catch(function () { return { ok: false, reason: 'unconfirmed' }; });
  }
  // The same, tried again after a pause when the answer is unclear or the site had a fault. Used for the calls the
  // visitor does not wait on. A plain refusal, "busy" and "not-connected" are not tried again.
  function postSure(path, entry, tries) {
    return post(path, entry).then(function (r) {
      if ((r && r.ok) || tries <= 1 || !(r.reason === 'unconfirmed' || r.reason === 'error')) { return r; }
      return new Promise(function (go) { setTimeout(go, 1500); }).then(function () { return postSure(path, entry, tries - 1); });
    });
  }
  // The public counts for this set. Anything else (not connected, another set, no reply) fails.
  function getResults() {
    if (quiet()) { return Promise.reject(new Error('results: votes are not being saved')); }
    return timed('/api/results?set=' + encodeURIComponent(cfg.set), { headers: { accept: 'application/json' } }, 10000)
      .then(whole).then(function (d) {
        if (!d || d.ok !== true || d.set !== cfg.set || !Array.isArray(d.rows)) { throw new Error('results: not this set'); }
        return d;
      });
  }

  /* ---- an answer keeps its own words ---- */
  // Its own headings sit under the card's heading, in the same order, and contents links that point to no place in
  // the answer are shown as plain text (the same as js/game.js).
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
  function putAnswer(node, html, top) {
    node.innerHTML = html;            // built by our own build, from the saved replies
    fitAnswer(node, top);
  }

  /* ---- who wrote it: the name, the maker, how it was set up, one line of what it is, up to three ways to try
          it; everything else (what was tested, the frozen details, the license, what each way needs) is inside one
          closed <details> ---- */
  function sentence(text) { return text + (/[.?!)]$/.test(text) ? '' : '.'); }
  // Words with `code` in them: the marked parts become <code>, the rest stays text.
  function rich(node, text) {
    String(text).split('`').forEach(function (part, i) {
      if (!part) { return; }
      node.appendChild(i % 2 ? make('code', '', part) : document.createTextNode(part));
    });
    return node;
  }
  function kindName(id, short) {
    var kinds = cfg.try_kinds || [];
    for (var i = 0; i < kinds.length; i++) { if (kinds[i].id === id) { return (short && kinds[i].short) || kinds[i].name; } }
    return '';
  }
  function has(map, key) { return Object.prototype.hasOwnProperty.call(map || {}, key); }
  // A link that leaves the page opens in a new tab and says so: a small arrow, and words for a screen reader.
  // Called once the link has its words, so the arrow comes after them.
  function newTab(a) {
    var NS = 'http://www.w3.org/2000/svg', mark = document.createElementNS(NS, 'svg'), line = document.createElementNS(NS, 'path');
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    mark.setAttribute('class', 'vote-ext');
    mark.setAttribute('viewBox', '0 0 12 12');
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('focusable', 'false');
    line.setAttribute('d', 'M3 9 9 3M4.2 3H9v4.8');
    mark.appendChild(line);
    a.appendChild(mark);
    a.appendChild(make('span', 'sr', ' (opens in a new tab)'));
    return a;
  }
  function tryLink(t, cls) {
    var a = make('a', cls || '');
    a.href = t.url;
    return a;
  }
  // The ways to try a model that a card shows: at most three. The others are under Details.
  function shownTry(m) { return ((m && m['try']) || []).filter(function (t) { return !t.in_details; }); }
  // A chat link comes first when there is one (the build keeps it first). When there is none, one plain line says
  // what trying this model takes, before its links.
  function tryNeed(m) {
    var routes = (m && m['try']) || [];
    if (!routes.length || routes.some(function (t) { return t.kind === 'app'; })) { return null; }
    return make('p', 'vote-try-need', 'To try this one you need a download or developer access.');
  }
  function tryRows(m) {            // as clear rows, one to a line
    var routes = shownTry(m);
    if (!routes.length) { return null; }
    var ul = make('ul', 'vote-try-rows');
    routes.forEach(function (t) {
      var li = make('li'), a = tryLink(t, 'sp-trylink vote-try-row');
      a.appendChild(make('span', 'sp-trylink-kind vote-try-kind', kindName(t.kind, true)));
      a.appendChild(make('span', 'sp-trylink-label vote-try-label', t.label));
      li.appendChild(newTab(a));
      ul.appendChild(li);
    });
    return ul;
  }
  // "Where to try it": the plain line when there is no chat link, then the rows. Nothing when there is no way.
  function tryBox(m, level) {
    var need = tryNeed(m), rows = tryRows(m);
    if (!need && !rows) { return null; }
    var box = make('div', 'sp-try vote-try');
    box.appendChild(make(level || 'h4', 'sp-try-h', 'Where to try it'));
    if (need) { box.appendChild(need); }
    if (rows) { box.appendChild(rows); }
    return box;
  }
  function tryLine(m) {            // the same links, in one line
    var routes = shownTry(m);
    if (!routes.length) { return null; }
    var p = make('p', 'vote-try-line');
    routes.forEach(function (t) {
      var a = tryLink(t);
      F.setText(a, t.label);
      p.appendChild(newTab(a));
    });
    return p;
  }
  function tryText(m) {            // every way, as plain text for "Copy this list"
    var lines = [];
    ((m && m['try']) || []).forEach(function (t) {
      lines.push('  ' + t.label + ': ' + t.url + ' (needs: ' + t.needs + ')');
    });
    return lines;
  }
  // opts: lead (the maker and the line of what it is go inside, where the card above does not show them),
  //       more (adds the link to more of its answers)
  function detailsBox(key, opts) {
    opts = opts || {};
    var m = cfg.models[key] || { name: key, maker: '', tested: '' };
    var d = make('details', 'vote-details');
    d.appendChild(make('summary', '', 'Details'));
    var body = make('div', 'vote-details-body');
    if (opts.lead) {
      if (m.maker) { body.appendChild(make('p', 'vote-fact', 'Made by ' + m.maker + '.')); }
      if (m.what) { body.appendChild(make('p', 'vote-fact', m.what)); }
      if (m.setup_note) { body.appendChild(make('p', 'vote-fact', m.setup_note)); }
    }
    if (m.tested) { body.appendChild(make('p', 'vote-fact', 'What was tested: ' + m.tested)); }
    if (m.details && m.details.length) {
      var dl = make('dl', 'vote-frozen');
      m.details.forEach(function (row) {
        dl.appendChild(make('dt', '', row[0]));
        dl.appendChild(rich(make('dd'), row[1]));
      });
      body.appendChild(dl);
    }
    if (m.license) { body.appendChild(make('p', 'vote-fact', 'License: ' + sentence(m.license))); }
    var routes = (m['try']) || [], checked = '';
    if (routes.length) {
      body.appendChild(make('p', 'vote-try-head', 'What each way to try it needs'));
      var ul = make('ul', 'vote-try-list');
      routes.forEach(function (t) {
        var li = make('li');
        if (t.in_details) {              // not among the rows above, so its link is here
          var a = tryLink(t);
          F.setText(a, t.label);
          li.appendChild(newTab(a));
        } else {
          li.appendChild(make('strong', '', t.label));
        }
        li.appendChild(make('span', 'vote-try-needs', kindName(t.kind) + '. Needs: ' + sentence(t.needs)));
        if (t.note) { li.appendChild(rich(make('span', 'vote-try-note'), t.note)); }
        ul.appendChild(li);
        if (t.checked > checked) { checked = t.checked; }
      });
      body.appendChild(ul);
      if (checked) { body.appendChild(make('p', 'vote-try-checked', 'Links checked ' + F.usDate(checked) + '.')); }
    }
    if (opts.more) { body.appendChild(moreLink(key)); }
    d.appendChild(body);
    return d;
  }
  // More of one model's answers: the answers page, with that model chosen (#model=<key>), in a new tab.
  function moreLink(key) {
    var more = make('a', 'vote-more', 'Read more of its answers');
    more.href = F.root + 'vote/answers/#model=' + encodeURIComponent(key);
    return newTab(more);
  }
  // Who made it and how it was set up, as plain small text beside the name. `short` leaves out "Made by".
  function byLine(m, tag, short) {
    var by = make(tag || 'p', 'vote-by');
    if (m.maker) { by.appendChild(make('span', 'vote-maker', (short ? '' : 'Made by ') + m.maker)); }
    if (m.setup) { by.appendChild(make('span', 'vote-setup', m.setup)); }
    return by;
  }
  function fullName(m) { return m.name + (m.setup ? ', ' + m.setup.charAt(0).toLowerCase() + m.setup.slice(1) : ''); }
  // opts: more (the link to more of its answers), bare (no name line), by (the maker's line all the same),
  //       heading (the name as a heading of this kind), lead (a small line before the name),
  //       out (say so when the model is not in the vote), sub (the kind of heading over "Where to try it"),
  //       tail (another box for Details and the link to more answers, so a step's main button can come first)
  function describe(node, key, opts) {
    opts = opts || {};
    var m = cfg.models[key] || { name: key, maker: '', tested: '' };
    node.textContent = '';
    if (opts.lead) { node.appendChild(make('p', 'sp-note vote-was', opts.lead)); }
    if (!opts.bare) { node.appendChild(make(opts.heading || 'strong', 'vote-name', m.name)); }
    if ((!opts.bare || opts.by) && (m.maker || m.setup)) { node.appendChild(byLine(m)); }
    if (opts.out && outReason(key)) { node.appendChild(make('p', 'vote-fact', 'Not in the vote: ' + outReason(key))); }
    if (m.what) { node.appendChild(make('p', 'vote-what', m.what)); }
    if (m.setup_note) { node.appendChild(make('p', 'vote-setup-note', m.setup_note)); }
    var where = tryBox(m, opts.sub), rest = opts.tail || node;
    if (where) { node.appendChild(where); }
    if (opts.tail) { rest.textContent = ''; }
    rest.appendChild(detailsBox(key));
    if (opts.more) { rest.appendChild(moreLink(key)); }
  }
  function outReason(key) {        // why a model is not in the vote, or ''
    var rows = cfg.not_in_rotation || [];
    for (var i = 0; i < rows.length; i++) { if (rows[i].model === key) { return rows[i].reason; } }
    return '';
  }
  function leftOut(key, question) { return ((cfg.left_out || {})[key] || []).indexOf(question) >= 0; }

  /* =====================================================================================================
     The results page: every model in a fixed order, the whole split of its votes, nothing ranked
     ===================================================================================================== */
  if (el.getAttribute('data-vote') === 'results') {
    var none = one('[data-none]'), boxes = all('[data-results]'), groupsEl = one('[data-groups]'), prefsEl = one('[data-prefs]');
    var totalsEl = one('[data-totals]'), download = one('[data-download]');
    var viewSel = one('[data-view]');
    var data = null, view = 'all', totalsText = '';

    function inView(r) {
      if (r.flagged) { return false; }                       // flagged votes are in the download, not in the numbers
      if (view === 'all') { return true; }
      if (view === 'first') { return !!r.first; }
      if (view === 'unnamed') { return !r.opened_before; }
      return r.experience === view;
    }
    function blank() { return { very: 0, some: 0, no: 0, unsure: 0, total: 0 }; }
    function bar(parts, keys, total, prefix) {
      var b = make('div', 'vote-bar'), say = [];
      b.setAttribute('role', 'img');
      keys.forEach(function (k) {
        var part = document.createElement('i');
        part.className = prefix + k;
        part.style.width = (total ? parts[k] / total * 100 : 0) + '%';     // set from the script, so no style is written into the page
        b.appendChild(part);
        say.push((prefix ? PREFS[k] : VOTES[k]) + ' ' + parts[k]);
      });
      b.setAttribute('aria-label', total ? say.join(', ') + '.' : 'No votes yet.');
      return b;
    }
    // One compact row: the name, then the maker, the setup and the state as plain small text, and the count.
    function who(key, total, word) {
      var m = cfg.models[key] || { name: key, maker: '' };
      var head = make('div', 'vote-who');
      head.appendChild(make('strong', 'vote-name', m.name));
      var by = byLine(m, 'span', true);
      if (outReason(key)) { by.appendChild(make('span', 'vote-tag', 'Not in the vote')); }
      else if (total < cfg.min_votes) { by.appendChild(make('span', 'vote-tag', 'Still gathering')); }
      head.appendChild(by);
      head.appendChild(make('span', 'vote-n', count(total, word)));
      return head;
    }
    function countsLine(keys, names, got) {      // "Very 5 · Somewhat 4": the name small, the count plain
      var p = make('p', 'vote-counts');
      keys.forEach(function (k, i) {
        if (i) { p.appendChild(document.createTextNode(' · ')); }
        var part = make('span', 'nb', names[k] + ' ');
        part.appendChild(make('b', '', String(got[k])));
        p.appendChild(part);
      });
      return p;
    }
    function draw() {
      var by = {}, shown = 0;
      cfg.order.forEach(function (k) { by[k] = { all: blank(), perQ: {}, yes: 0, maybe: 0, no: 0, answered: 0, any: 0 }; });
      data.rows.forEach(function (r) {
        var t = by[r.model], n = Number(r.n) || 0;
        if (t) { t.any += n; }                                // every kept vote, in any view, flagged or not
        if (!t || !inView(r) || !VOTES[r.vote]) { return; }
        var q = t.perQ[r.question] || (t.perQ[r.question] = blank());
        t.all[r.vote] += n; t.all.total += n;
        q[r.vote] += n; q.total += n;
        if (PREFS[r.pref]) { t[r.pref] += n; t.answered += n; }
        shown += n;
      });
      groupsEl.textContent = '';
      prefsEl.textContent = '';
      cfg.groups.forEach(function (g) {
        // a model that is not in the vote has a row only if it has votes; otherwise it is in the list below, with its reason
        var keys = cfg.order.filter(function (k) { return cfg.models[k] && cfg.models[k].group === g.id && (!outReason(k) || by[k].any > 0); });
        if (!keys.length) { return; }
        var list = make('ul', 'vote-rows'), plist = make('ul', 'vote-rows vote-rows-pref');
        keys.forEach(function (k) {
          var t = by[k], li = make('li', 'vote-item' + (k === cfg.check ? ' vote-check' : ''));
          li.setAttribute('data-model', k);
          li.appendChild(who(k, t.all.total, 'vote'));
          li.appendChild(bar(t.all, VOTE_KEYS, t.all.total, ''));
          li.appendChild(t.all.total ? countsLine(VOTE_KEYS, SHORT_VOTES, t.all) : make('p', 'vote-counts', 'No votes yet.'));
          // every message of this model has votes: the average across messages, each message counted equally
          var mine = cfg.questions.filter(function (q) { return !leftOut(k, q); });
          if (mine.length && mine.every(function (q) { return t.perQ[q] && t.perQ[q].total > 0; })) {
            var avg = VOTE_KEYS.map(function (v) {
              var sum = 0;
              mine.forEach(function (q) { sum += t.perQ[q][v] / t.perQ[q].total; });
              return Math.round(sum / mine.length * 100) + '%';
            });
            // the same four answers in the same order as the line above
            var line = make('p', 'vote-avg', 'Messages counted equally: ' + avg.join(' · '));
            line.setAttribute('aria-label', 'Average across messages, each message counted equally: ' + VOTE_KEYS.map(function (v, i) { return VOTES[v] + ' ' + avg[i]; }).join(', ') + '.');
            li.appendChild(line);
          }
          list.appendChild(li);
          var pl = make('li', 'vote-item' + (k === cfg.check ? ' vote-check' : ''));
          pl.setAttribute('data-model', k);
          // one line a model: its name, then Yes, Maybe and No, which add up to the answers it has
          var ph = make('div', 'vote-who');
          ph.appendChild(make('strong', 'vote-name', fullName(cfg.models[k])));
          var got = t.answered ? countsLine(PREF_KEYS, PREFS, t) : make('p', 'vote-counts', 'No answers yet');
          got.setAttribute('data-answers', String(t.answered));
          ph.appendChild(got);
          pl.appendChild(ph);
          plist.appendChild(pl);
        });
        var group = panel(g.name, 'h2', true, 'vote-group');      // one panel a group, its rows inside
        group.box.appendChild(list);
        groupsEl.appendChild(group.box);
        prefsEl.appendChild(make('h3', 'vote-h3', g.name));
        prefsEl.appendChild(plist);
      });
      totalsEl.textContent = totalsText + ' This view counts ' + count(shown, 'vote') + '.';
    }
    function noVotes() {
      boxes.forEach(function (b) { b.hidden = true; });
      if (download) { download.hidden = true; }
      none.textContent = 'No votes yet.';
      none.hidden = false;
    }

    getSettings().then(function (s) { cfg = s; return getResults(); }).then(function (d) {
      if (!(Number(d.votes) > 0)) { noVotes(); return; }
      data = d;
      var flagged = 0;
      d.rows.forEach(function (r) { if (r.flagged) { flagged += Number(r.n) || 0; } });
      totalsText = count(Number(d.votes), 'vote') + ' kept, in ' + count(Number(d.sittings) || 0, 'sitting') + '.' +
        (flagged ? ' ' + count(flagged, 'flagged vote') + (flagged === 1 ? ' is' : ' are') + ' left out of the numbers here.' : '') +
        (/^\d{4}-\d\d-\d\d/.test(d.updated || '') ? ' Counted on ' + F.usDate(d.updated) + '.' : '');
      view = viewSel.value || 'all';
      viewSel.addEventListener('change', function () { view = viewSel.value; draw(); });
      draw();
      none.hidden = true;
      boxes.forEach(function (b) { b.hidden = false; });
      if (download) { download.hidden = false; }
    }).catch(noVotes);
    return;
  }

  /* =====================================================================================================
     The answers page: every reply, with names, without voting. Two views:
       by message   one message, GPT-4o's reply to it, and every model's reply (each closed until it is opened)
       by model     one model: its name on top, then its reply to every message, open, each with GPT-4o's reply to
                    the same message in a closed, labeled box. /vote/answers/#model=<key> opens this view.
     ===================================================================================================== */
  if (el.getAttribute('data-vote') === 'answers') {
    var pickQ = one('[data-pick-q]'), pickM = one('[data-pick-m]'), pickQBox = one('[data-pick-q-box]'), warn = one('[data-warn]');
    var noneA = one('[data-none]'), browse = one('[data-browse]');
    var bq = one('[data-q]'), bref = one('[data-ref]'), listEl = one('[data-list]');
    var prevQ = one('[data-prev-q]'), nextQ = one('[data-next-q]');
    var modelView = one('[data-model-view]'), modelHead = one('[data-model-head]'), modelList = one('[data-model-list]');
    var asked = 0, refs = null;

    function getModel(key) {
      return timed(F.root + 'vote/data/' + cfg.set + '/by-model/' + encodeURIComponent(key) + '.json', {}, 20000).then(whole);
    }
    function getRefs() {
      if (refs) { return Promise.resolve(refs); }
      return timed(F.root + 'vote/data/' + cfg.set + '/reference.json', {}, 20000).then(whole).then(function (d) { refs = d; return d; });
    }
    // The address says which view this is, so a link to it opens the same view. Nothing is stored.
    function address(q, m) {
      var to = m ? window.location.pathname + '#model=' + encodeURIComponent(m) : '?q=' + encodeURIComponent(q);
      try { history.replaceState(null, '', to); } catch (e) { /* the address stays as it was */ }
    }
    function failed() {
      browse.hidden = true;
      modelView.hidden = true;
      noneA.textContent = 'The answers could not be loaded. Please try again in a moment.';
      noneA.hidden = false;
    }

    function entry(key, html) {
      var m = cfg.models[key] || { name: key, maker: '' };
      var d = make('details', 'vote-ans');
      d.id = 'm-' + key;
      var s = make('summary');
      s.appendChild(make('strong', 'vote-name', m.name));
      var by = byLine(m, 'span', true), why = outReason(key);
      if (why) { by.appendChild(make('span', 'vote-tag', 'Not in the vote')); }
      else if (leftOut(key, pickQ.value)) { by.appendChild(make('span', 'vote-tag', 'Not in the vote for this message')); }
      s.appendChild(by);
      d.appendChild(s);
      var body = make('div', 'vote-ans-body');
      if (why) { body.appendChild(make('p', 'vote-fact', 'Not in the vote: ' + why)); }
      var said = turn('other', m.name, 'Its reply', 'h4', initial(m.name)), text = make('div', 'answer-text');
      putAnswer(text, html, 5);
      said.body.appendChild(text);
      body.appendChild(said.box);
      var facts = make('div', 'vote-facts');
      describe(facts, key, { bare: true });
      body.appendChild(facts);
      d.appendChild(body);
      return d;
    }
    function drawMessage(focus) {
      var q = pickQ.value, mine = ++asked;
      var at = cfg.questions.indexOf(q);
      prevQ.disabled = at <= 0;
      nextQ.disabled = at >= cfg.questions.length - 1;
      address(q, '');
      getReplies(q).then(function (d) {
        if (mine !== asked) { return; }
        bq.textContent = d.prompt;
        putAnswer(bref, d.ref.html, 3);
        listEl.textContent = '';
        cfg.groups.forEach(function (g) {
          var keys = cfg.order.filter(function (k) { return cfg.models[k].group === g.id && d.answers[k]; });
          if (!keys.length) { return; }
          listEl.appendChild(make('h3', 'vote-h', g.name));
          keys.forEach(function (k) { listEl.appendChild(entry(k, d.answers[k].html)); });
        });
        warn.hidden = false;
        pickQBox.hidden = false;
        modelView.hidden = true;
        noneA.hidden = true;
        browse.hidden = false;
        if (focus) { bq.focus({ preventScroll: true }); browse.scrollIntoView({ block: 'start' }); }
      }).catch(function () { if (mine === asked) { failed(); } });
    }
    function drawModel(focus) {
      var key = pickM.value, mine = ++asked;
      var m = cfg.models[key];
      address('', key);
      Promise.all([getModel(key), getRefs()]).then(function (got) {
        if (mine !== asked) { return; }
        var theirs = got[0].answers, ref = got[1].answers, n = cfg.messages.length;
        // the model on top, in a panel whose title bar is its name; then one thread, an exchange for each message
        modelHead.textContent = '';
        var bar = make('div', 'sp-panel-bar'), about = make('div', 'sp-panel-body');
        bar.appendChild(make('span', 'sp-num vote-model-mark', initial(m.name)));
        bar.appendChild(make('h2', 'vote-name', m.name));
        modelHead.appendChild(bar);
        modelHead.appendChild(about);
        describe(about, key, { bare: true, by: true, out: true, sub: 'h3' });
        modelList.textContent = '';
        cfg.messages.forEach(function (msg, i) {
          if (!theirs[msg.id] || !ref[msg.id]) { return; }
          var sec = make('section', 'vote-mine');
          sec.id = 'q-' + msg.id;
          sec.appendChild(make('h3', 'sp-divider', 'Message ' + (i + 1) + ' of ' + n));
          var said = turn('person', 'The message', 'A person wrote', 'h4');
          said.body.appendChild(make('blockquote', 'chat-turn-quote', msg.text));
          sec.appendChild(said.box);
          var card = turn('other', m.name, leftOut(key, msg.id) ? 'Its reply. Not in the vote for this message' : 'Its reply', 'h4', initial(m.name));
          var text = make('div', 'answer-text');
          putAnswer(text, theirs[msg.id].html, 5);
          card.body.appendChild(text);
          sec.appendChild(card.box);
          // GPT-4o's reply to the same message: a turn of its own, closed until it is opened
          var cmp = make('details', 'chat-turn chat-turn-model vote-compare');
          var sum = turnHead('summary', 'gpt', "GPT-4o's reply to this message", 'Saved API reply');
          sum.appendChild(icon('chev', 'vote-open-mark'));
          cmp.appendChild(sum);
          var rb = make('div', 'chat-turn-b'), rt = make('div', 'answer-text');
          putAnswer(rt, ref[msg.id].html, 5);
          rb.appendChild(rt);
          cmp.appendChild(rb);
          sec.appendChild(cmp);
          modelList.appendChild(sec);
        });
        warn.hidden = true;
        pickQBox.hidden = true;
        browse.hidden = true;
        noneA.hidden = true;
        modelView.hidden = false;
        if (focus) { modelHead.focus({ preventScroll: true }); modelView.scrollIntoView({ block: 'start' }); }
      }).catch(function () { if (mine === asked) { failed(); } });
    }
    function drawAnswers(focus) { if (pickM.value) { drawModel(focus); } else { drawMessage(focus); } }
    function step(by) {
      var at = cfg.questions.indexOf(pickQ.value) + by;
      if (at < 0 || at >= cfg.questions.length) { return; }
      pickQ.value = cfg.questions[at];
      drawAnswers(true);
    }
    // #model=<key> chooses the model (so does ?m=<key>, from an older link); ?q=<id> chooses the message.
    function fromAddress() {
      var want = new URLSearchParams(window.location.search), hash = /^#model=(.+)$/.exec(window.location.hash || ''), key = '';
      if (hash) { try { key = decodeURIComponent(hash[1]); } catch (e) { key = ''; } }
      if (!key) { key = want.get('m') || ''; }
      pickM.value = has(cfg.models, key) ? key : '';
      if (cfg.questions.indexOf(want.get('q')) >= 0) { pickQ.value = want.get('q'); }
    }
    getSettings().then(function (s) {
      cfg = s;
      fromAddress();
      pickQ.addEventListener('change', function () { drawAnswers(false); });
      pickM.addEventListener('change', function () { drawAnswers(false); });
      prevQ.addEventListener('click', function () { step(-1); });
      nextQ.addEventListener('click', function () { step(1); });
      one('[data-open-all]').addEventListener('click', function () { all('details.vote-ans', listEl).forEach(function (d) { d.open = true; }); });
      one('[data-close-all]').addEventListener('click', function () { all('details.vote-ans', listEl).forEach(function (d) { d.open = false; }); });
      window.addEventListener('hashchange', function () { fromAddress(); drawAnswers(false); });
      drawAnswers(false);
    }).catch(function () {
      noneA.textContent = 'The answers could not be loaded. Please try again in a moment.';
    });
    return;
  }

  /* =====================================================================================================
     Comparing replies
     ===================================================================================================== */
  var screens = all('[data-screen]');
  // The band above the page (the shell's header): the back button, where this is, the screen's name, the progress.
  var band = document.querySelector('[data-band]'), backEl = document.querySelector('[data-back]');
  var backLabel = document.querySelector('[data-back-label]'), crumbEl = document.querySelector('[data-crumb]');
  var countEl = document.querySelector('[data-title]'), marksEl = document.querySelector('[data-prog]');
  var OPENING = { back: backLabel.textContent, to: backEl.getAttribute('href'), crumb: crumbEl.textContent, title: countEl.textContent };
  var SECTION = el.getAttribute('data-section') || 'Compare', PAGE = el.getAttribute('data-name') || 'Compare replies';
  var startBtn = one('[data-start]'), loadFail = one('[data-load-fail]');
  var qEl = one('[data-q]'), refEl = one('[data-ref]'), candEl = one('[data-cand]');
  var candTag = one('[data-cand-tag]'), HIDDEN = candTag.textContent, candAv = one('[data-cand-av]');
  var answerEl = one('[data-answer]'), stepBar = one('[data-step-bar]'), homeLink = one('[data-home]'), moreWords = one('[data-more-words]');
  var rateBox = one('[data-rate]'), ratedBox = one('[data-rated]'), saidEl = one('[data-said]');
  var choiceBtns = all('[data-v]'), skipBtn = one('[data-skip]');
  var skipSaid = one('[data-skip-said]'), skipped = false;
  var statusEl = one('[data-status]'), retryRow = one('[data-retry-row]'), retryBtn = one('[data-retry]');
  var after = one('[data-voted]'), prefBox = one('[data-pref-box]'), prefBtns = all('[data-p]');
  var prefDone = one('[data-pref-done]'), prefSaidEl = one('[data-pref-said]'), prefStatus = one('[data-pref-status]');
  var reveal = one('[data-reveal]'), revealMore = one('[data-reveal-more]');
  var whoBtn = one('[data-who]'), nextBtn = one('[data-next]'), finishBtn = one('[data-finish]');
  var readEl = one('[data-read]'), readLead = one('[data-read-lead]'), moreBtn = one('[data-more]'), againBtn = one('[data-again]');
  var likedBox = one('[data-liked]'), likedList = one('[data-liked-list]'), copyBtn = one('[data-copy-liked]');
  var copyStatus = one('[data-copy-status]'), copyText = one('[data-copy-text]');
  var trap = one('input[name="website"]');      // people never see this box; a filled one is a robot

  var experience = null;        // never | casual | power | skip: asked once, before the first comparison
  var sitting = '';             // this sitting's random code. A variable only: a reload starts a new sitting
  var rounds = [];              // this sitting's comparisons that got a vote, in order. A comparison's number is its place here
  var target = 0;               // where this stretch of the sitting ends: rounds_first, then rounds_max
  var usedQ = {}, usedM = {};   // voted on in this sitting: never again in it
  var shownQ = {}, shownM = {}; // shown in this sitting, voted or skipped: not again while anything else is left
  var seenCell = {};            // every reply shown since the page loaded: not shown twice while another is left
  var opened = false;           // has any model's name been shown to this visitor since the page loaded?
  var votesFor = {}, votesForPair = {};    // the counted votes read when the sitting started: by model, by model and message
  var current = null;           // the comparison on the screen
  var liked = [];               // models answered "Yes" to since the page loaded, for the list to copy
  var recapShown = false;       // has this sitting's list of comparisons, with names, been shown?
  var busy = false;             // a comparison is being fetched: a second press does nothing

  // The progress under the band: the comparisons done, the one on the screen, the ones to come.
  function drawMarks(name) {
    var n = Math.max(target || cfg.rounds_first, rounds.length), at = -1, done = rounds.length;
    if (name === 'round' && current) { at = current.n ? current.n - 1 : rounds.length; done = at; }
    if (name === 'exp') { done = 0; }
    marksEl.textContent = '';
    for (var i = 0; i < n; i++) {
      var mark = document.createElement('i');
      if (i < done) { mark.className = 'is-done'; } else if (i === at) { mark.className = 'is-now'; }
      marksEl.appendChild(mark);
    }
  }
  // A screen starts right under the band. In a sitting the support line and, on a phone, the top bar are scrolled
  // away, so the message is near the top; the opening starts at the very top of the page.
  function toTop(name) {
    if (name === 'intro') { window.scrollTo(0, 0); return; }
    var main = document.getElementById('main'), top = document.querySelector('.sp-top');
    var held = band.offsetHeight + (top && window.getComputedStyle(top).position === 'sticky' ? top.offsetHeight : 0);
    var want = Math.max(0, Math.round(main.getBoundingClientRect().top + window.pageYOffset - held));
    // a screen too short to be scrolled that far starts at the very top, so the top bar is whole, not cut
    var can = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, want <= can ? want : 0);
  }
  // The band says where this is and names the way back: Home from the opening, the opening from anywhere in a sitting.
  function show(name) {
    var shown = null, inside = name !== 'intro';
    for (var i = 0; i < screens.length; i++) {
      screens[i].hidden = screens[i].getAttribute('data-screen') !== name;
      if (!screens[i].hidden) { shown = screens[i]; }
    }
    el.setAttribute('data-state', name);
    backLabel.textContent = inside ? SECTION : OPENING.back;
    backEl.setAttribute('href', inside ? './' : OPENING.to);
    crumbEl.textContent = inside ? PAGE : OPENING.crumb;
    if (name === 'intro') { countEl.textContent = OPENING.title; }
    if (name === 'round') { countEl.textContent = 'Comparison ' + (current && current.n ? current.n : rounds.length + 1) + ' of ' + target; }
    if (name === 'exp') { countEl.textContent = 'One question first'; }
    if (name === 'thanks') { countEl.textContent = 'Finished'; }
    marksEl.hidden = !inside;
    if (inside) { drawMarks(name); }
    if (!shown) { return; }
    toTop(name);
    var head = name === 'round' ? countEl : shown.querySelector('[data-focus]');
    if (head) { head.focus({ preventScroll: true }); }
  }

  /* ---- the way back. Starting adds one step to the browser's history, with the same address and nothing stored,
          so the browser's own Back leaves a sitting for the opening, as the band's back button does. Forward
          returns to the comparison that was on the screen. ---- */
  var stepped = false;
  var left = 0;                 // how many times the visitor has gone back to the opening: a load that started before
                                // the last one is dropped when it ends, so it cannot pull them into a comparison
  function stepIn() {
    if (stepped) { return; }
    try { window.history.pushState({ vote: 'sitting' }, ''); stepped = true; } catch (e) { /* Back then leaves the page */ }
  }
  function toOpening() {
    var r = current;
    if (r && r.n && !r.prefClosed) { closePref(r, ''); stage(r); }      // leaving with the second question open skips it
    left += 1;
    show('intro');
  }
  function goBack(ev) {
    if (el.getAttribute('data-state') === 'intro') { return; }           // on the opening the link is an ordinary one
    ev.preventDefault();
    if (stepped) { window.history.back(); } else { toOpening(); }
  }
  window.addEventListener('popstate', function (ev) {
    var state = el.getAttribute('data-state');
    stepped = !!(ev.state && ev.state.vote === 'sitting');
    if (!stepped) { if (state !== 'intro') { toOpening(); } else { left += 1; } return; }
    if (state !== 'intro') { return; }
    if (current) { show('round'); } else if (rounds.length) { show('thanks'); drawRecap(); } else if (!experience) { show('exp'); }
  });

  // 16 random bytes as 22 characters of A-Z a-z 0-9 _ -
  function newCode() {
    var bytes = new Uint8Array(16), text = '';
    window.crypto.getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) { text += String.fromCharCode(bytes[i]); }
    return window.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* ---- choosing a comparison: about equal turns for every model in the vote, the check among them ---- */
  function readCounts(d) {
    votesFor = {};
    votesForPair = {};
    ((d && d.rows) || []).forEach(function (r) {
      var n = Number(r.n) || 0;
      if (r.flagged) { return; }
      votesFor[r.model] = (votesFor[r.model] || 0) + n;
      votesForPair[r.model + ' ' + r.question] = (votesForPair[r.model + ' ' + r.question] || 0) + n;
    });
  }
  function lowest(list, votes, within) {   // those whose count is within `within` of the lowest
    var low = Infinity;
    list.forEach(function (k) { low = Math.min(low, votes(k)); });
    return list.filter(function (k) { return votes(k) <= low + within; });
  }
  // The messages a model may be shown with now: not voted on in this sitting, and not a reply the name check left
  // out. Of those, the ones not yet shown in this sitting and not seen since the page loaded, while any is left.
  function messagesFor(model) {
    var free = cfg.questions.filter(function (q) { return !usedQ[q] && !leftOut(model, q); });
    var fresh = free.filter(function (q) { return !shownQ[q] && !seenCell[model + ' ' + q]; });
    if (!fresh.length) { fresh = free.filter(function (q) { return !seenCell[model + ' ' + q]; }); }
    return fresh.length ? fresh : free;
  }
  function chooseRound(avoid) {
    var open = cfg.eligible.filter(function (k) { return !usedM[k] && !avoid[k] && messagesFor(k).length; });
    var fresh = open.filter(function (k) { return !shownM[k]; });      // not shown in this sitting, while any is left
    var from = fresh.length ? fresh : open;
    if (!from.length) { return null; }
    var model = pick(lowest(from, function (k) { return votesFor[k] || 0; }, cfg.near_lowest));
    var question = pick(lowest(messagesFor(model), function (q) { return votesForPair[model + ' ' + q] || 0; }, 0));
    return { model: model, question: question };
  }

  /* ---- a sitting ---- */
  function startSitting() {
    if (busy) { return; }
    busy = true;
    sitting = newCode();
    rounds = [];
    target = cfg.rounds_first;
    usedQ = {}; usedM = {}; shownQ = {}; shownM = {};
    recapShown = false;
    var mark = left;
    // read the counts once; if that fails, every count is zero
    getResults().then(readCounts, function () { readCounts(null); }).then(function () {
      busy = false;
      if (left === mark) { nextRound(); }      // the visitor went back while the counts were read: stay on the opening
    });
  }

  function loadRound(avoid, tries) {
    var c = chooseRound(avoid);
    if (!c) { return Promise.reject(new Error('nothing left to show')); }
    return getReplies(c.question).then(function (d) {
      var cand = d.answers && d.answers[c.model];
      if (!d.ref || !d.ref.html || !cand || !cand.html) { throw new Error('no answer'); }
      return { question: c.question, model: c.model, prompt: d.prompt, ref: d.ref.html, cand: cand.html };
    }).catch(function (e) {
      if (tries >= 2) { throw e; }
      avoid[c.model] = true;
      return loadRound(avoid, tries + 1);
    });
  }

  /* ---- one thing to do at a time: the rating; then the second question; then the name, or the next comparison.
          The name can be asked for only once the second question is answered or skipped, and the second question
          is never open once a name is on the screen. ---- */
  function primary(button, on) { button.className = on ? 'vbtn vbtn-primary vbtn-wide' : 'vlink'; }
  // On a phone the answer panel is under the thread: after each step it is brought into view, and after the name
  // its top is, so the name is the first thing read. On a wide screen it stays beside the thread.
  function settle(top) {
    answerEl.scrollTop = 0;
    if (window.matchMedia('(max-width: 959px)').matches) { answerEl.scrollIntoView({ block: top ? 'start' : 'nearest' }); }
  }
  // The check mark beside an answer is shown only once that answer is saved.
  function marks(r) {
    one('.sp-saved', ratedBox).classList.toggle('is-unsaved', r.state !== 'saved');
    one('.sp-saved', prefDone).classList.toggle('is-unsaved', r.pref ? r.prefState !== 'saved' : r.state !== 'saved');
  }
  function stage(r) {
    var voted = !!r.n, last = voted && r.n >= target;
    marks(r);
    rateBox.hidden = voted;
    ratedBox.hidden = !voted;
    after.hidden = !voted;
    stepBar.textContent = !voted ? 'Step 1 of 3' : !r.prefClosed ? 'Step 2 of 3' : r.revealed ? 'Step 3 of 3: the name' : 'Step 3 of 3';
    if (!voted) { return; }
    words(saidEl, 'You said: ', VOTES[r.value], '.');
    prefBox.hidden = !!r.prefClosed;
    prefDone.hidden = !r.prefClosed;
    if (r.prefClosed) { words(prefSaidEl, 'Would you like a reply like this? ', PREFS[r.pref] || 'Skipped', '.'); } else { prefSaidEl.textContent = ''; }
    whoBtn.hidden = !r.prefClosed || !!r.revealed;
    reveal.hidden = !r.revealed;
    revealMore.hidden = !r.revealed;
    nextBtn.hidden = last;
    finishBtn.hidden = !last && !r.prefClosed;
    primary(nextBtn, !!r.revealed && !last);
    primary(finishBtn, !!r.revealed && last);
  }

  function nextRound() {
    if (busy) { return; }
    if (rounds.length >= target) { finish(); return; }
    busy = true;
    var mark = left;
    loadRound({}, 0).then(function (r) {
      busy = false;
      if (left !== mark) { return; }           // the visitor went back while it loaded: it was never shown, so it is dropped
      shownQ[r.question] = shownM[r.model] = true;
      seenCell[r.model + ' ' + r.question] = true;
      qEl.textContent = r.prompt;
      putAnswer(refEl, r.ref, 3);
      putAnswer(candEl, r.cand, 3);
      candTag.textContent = HIDDEN;
      candAv.textContent = '?';
      answerEl.scrollTop = 0;
      var i;
      for (i = 0; i < choiceBtns.length; i++) {
        choiceBtns[i].disabled = false;
        choiceBtns[i].setAttribute('aria-pressed', 'false');
      }
      for (i = 0; i < prefBtns.length; i++) {
        prefBtns[i].disabled = false;
        prefBtns[i].setAttribute('aria-pressed', 'false');
      }
      all('details[open]', one('[data-screen="round"]')).forEach(function (d) { d.open = false; });
      statusEl.textContent = '';
      prefStatus.textContent = '';
      retryRow.hidden = true;
      reveal.textContent = '';
      revealMore.textContent = '';
      current = { question: r.question, model: r.model, prompt: r.prompt, n: 0, state: '', pref: '', shownAt: 0,
        chain: Promise.resolve() };
      stage(current);
      el.setAttribute('data-question', r.question);
      show('round');
      // after "Skip this comparison" the heading reads the same ("Comparison 2 of 3"): a spoken line says a new one is here
      if (skipSaid) { skipSaid.textContent = skipped ? skipSaid.getAttribute('data-words') : ''; }
      skipped = false;
      current.shownAt = performance.now();      // the seconds are counted from the replies being shown
    }).catch(function () {
      busy = false;
      skipped = false;
      if (left !== mark) { return; }
      if (!rounds.length && !current) {
        loadFail.hidden = false;
        if (stepped) { window.history.back(); } else { show('intro'); }
      } else if (current && current.n) {
        statusEl.textContent = 'The next replies could not be loaded. Press "Next comparison" to try again, or "Finish".';
      } else {
        finish();
      }
    });
  }

  /* ---- saving: the page says "saved" only when the server has said so ---- */
  var SAID = {
    saving: 'Saving your vote.',
    saved: 'Your vote is saved.',
    off: 'Not recording yet. This vote was not saved.',
    busy: 'The site is busy. This vote is not saved.',
    unconfirmed: 'No clear answer came back. This vote may not be saved.',
    failed: 'Something went wrong. This vote is not saved.'
  };
  var SHORT = { saving: 'Saving', saved: 'Saved', off: 'Not recording yet', busy: 'Not saved', unconfirmed: 'May not be saved',
    failed: 'Not saved' };
  function canRetry(r) { return r.state === 'busy' || r.state === 'unconfirmed' || r.state === 'failed'; }

  // The second answer is saved only after its vote is. Until then the page says so.
  function prefSaid(r) {
    if (!r.pref) { return ''; }
    if (r.prefState === 'saved') { return 'Saved.'; }
    if (r.state === 'off') { return 'Not recording yet.'; }
    if (r.prefState === 'lost' || canRetry(r)) { return 'This answer is not saved.'; }
    return 'Saving.';
  }
  function paint(r) {
    if (current === r) {
      statusEl.textContent = SAID[r.state] || '';
      statusEl.classList.toggle('is-bad', canRetry(r));
      retryRow.hidden = !canRetry(r);
      prefStatus.textContent = prefSaid(r);
      marks(r);
    }
    if (el.getAttribute('data-state') === 'thanks') { drawRecap(); }
  }
  // Everything that follows a saved vote, one call after another: the second answer first, then the name. Each is
  // sent once it is wanted and the vote is known to be saved; calling this again does no harm.
  function flush(r) {
    if (r.state !== 'saved') { paint(r); return Promise.resolve(); }
    var go = Promise.resolve();
    if (r.pref && r.prefState !== 'saved' && r.prefState !== 'lost') {
      go = go.then(function () {
        return postSure('vote-pref', { set: cfg.set, sitting: r.body.sitting, round: r.n, pref: r.pref }, 3);
      }).then(function (a) { r.prefState = a && a.ok ? 'saved' : 'lost'; paint(r); });
    }
    if (r.revealed && !r.openedSent) {
      go = go.then(function () {
        return postSure('vote-opened', { set: cfg.set, sitting: r.body.sitting, round: r.n }, 3);
      }).then(function (a) { r.openedSent = !!(a && a.ok); });
    }
    if (r.recapWanted && !r.recapSent) {
      go = go.then(function () {
        return postSure('vote-recap', { set: cfg.set, sitting: r.body.sitting }, 3);
      }).then(function (a) {
        if (a && a.ok) { rounds.forEach(function (x) { if (x.state === 'saved' && x.body.sitting === r.body.sitting) { x.recapSent = true; } }); }
      });
    }
    return go;
  }
  function queue(r) { r.chain = r.chain.then(function () { return flush(r); }); return r.chain; }
  function saveVote(r) {
    r.state = 'saving';
    paint(r);
    r.chain = r.chain.then(function () { return post('vote', r.body); }).then(function (a) {
      // a filled "website" box (a browser's autofill, or a robot) is answered ok and nothing is kept: not "saved"
      r.state = a && a.ok ? (r.body.website ? 'failed' : 'saved') : a.reason === 'not-connected' ? 'off' : a.reason === 'busy' ? 'busy'
        : a.reason === 'unconfirmed' ? 'unconfirmed' : 'failed';
      paint(r);
      return flush(r);
    });
    return r.chain;
  }

  function onVote(ev) {
    if (!current || current.n || busy) { return; }
    var r = current, button = ev.currentTarget, value = button.getAttribute('data-v');
    // whole seconds, as the privacy page says; a tab left open for more than a day still sends a number the server takes
    var seconds = Math.min(86400, Math.max(0, Math.floor((performance.now() - r.shownAt) / 1000)));
    for (var i = 0; i < choiceBtns.length; i++) {
      choiceBtns[i].disabled = true;
      choiceBtns[i].setAttribute('aria-pressed', choiceBtns[i] === button ? 'true' : 'false');
    }
    rounds.push(r);
    r.n = rounds.length;                       // the comparison's number: its place among this sitting's votes
    r.value = value;
    usedQ[r.question] = usedM[r.model] = true;
    r.body = { set: cfg.set, sitting: sitting, round: r.n, experience: experience, question: r.question, model: r.model,
      vote: value, seconds: seconds, opened_before: opened, website: trap ? trap.value : '' };
    stage(r);
    saveVote(r);
    statusEl.focus({ preventScroll: true });
    settle(false);
  }

  // The second question is answered once, or skipped. After that its buttons are gone for this comparison.
  function closePref(r, chosen) {
    for (var i = 0; i < prefBtns.length; i++) {
      prefBtns[i].disabled = true;
      prefBtns[i].setAttribute('aria-pressed', prefBtns[i].getAttribute('data-p') === chosen ? 'true' : 'false');
    }
    r.prefClosed = true;
  }
  function onPref(ev) {
    var r = current;
    if (!r || !r.n || r.prefClosed || r.revealed) { return; }      // never after the name is shown
    var value = ev.currentTarget.getAttribute('data-p');
    closePref(r, value);
    if (PREFS[value]) {                        // "Skip this question" sends nothing, and the vote keeps an empty answer
      r.pref = value;
      if (value === 'yes' && liked.indexOf(r.model) < 0) { liked.push(r.model); }
    }
    stage(r);
    paint(r);
    whoBtn.focus({ preventScroll: true });
    settle(false);
    if (r.pref) { queue(r); }
  }

  function onWho() {
    var r = current;
    // The name waits for the second question: it must be answered or skipped first. Nothing is passed over silently.
    if (!r || !r.n || !r.prefClosed || r.revealed) { return; }
    r.revealed = true;
    opened = true;
    var name = (cfg.models[r.model] || {}).name || r.model;
    // the name, what it is and where to try it; then the way on; Details and more of its answers come after that
    describe(reveal, r.model, { more: true, heading: 'h3', lead: 'The other model was', tail: revealMore });
    candTag.textContent = 'Written by ' + name;
    candAv.textContent = initial(name);
    stage(r);
    reveal.focus({ preventScroll: true });
    settle(true);
    queue(r);
  }
  // "Next comparison" or "Finish" with the second question still open counts as skipping it.
  function leave(then) {
    var r = current;
    if (busy) { return; }
    if (r && r.n && !r.prefClosed) { closePref(r, ''); stage(r); }
    then();
  }

  /* ---- the thank-you: the visitor's comparisons, with every name ---- */
  // One panel a comparison: its number and the model's name in the title bar; inside, the message in the person's
  // colours, what was answered, and the same "Where to try it" box the name's step uses.
  function named(key) {                        // a liked model: its name, and its links in one line
    var box = make('li', 'vote-named'), m = cfg.models[key];
    box.appendChild(nameLine(key));
    var links = tryLine(m);
    if (links) { box.appendChild(links); }
    return box;
  }
  function drawRecap() {
    readEl.textContent = '';
    rounds.forEach(function (r) {
      var m = cfg.models[r.model] || { name: r.model };
      var li = make('li', 'sp-panel vote-card'), bar = make('div', 'sp-panel-bar sp-soft'), body = make('div', 'sp-panel-body');
      li.setAttribute('data-round', String(r.n));
      bar.appendChild(make('span', 'sp-num', String(r.n)));
      bar.appendChild(make('h3', 'vote-name', m.name));
      li.appendChild(bar);
      var msg = make('p', 'vote-quote vote-read-msg');
      msg.appendChild(make('b', '', 'The message'));
      msg.appendChild(make('span', 'vote-q', '“' + shortText(r.prompt, 90) + '”'));
      body.appendChild(msg);
      var said = make('p', 'vote-said');
      words(said, 'You said: ', VOTES[r.value], '. ');
      said.appendChild(make('span', 'vote-state vote-state-' + r.state, SHORT[r.state] ? SHORT[r.state] + '.' : ''));
      if (canRetry(r)) {
        var again = make('button', 'vlink', 'Try again');
        again.type = 'button';
        again.addEventListener('click', function () { saveVote(r); });
        said.appendChild(again);
      }
      body.appendChild(said);
      if (r.pref) {
        var wish = make('p', 'vote-said');
        words(wish, 'Would you like a reply like this? ', PREFS[r.pref], '. ');
        wish.appendChild(make('span', 'vote-state', prefSaid(r)));
        body.appendChild(wish);
      }
      var about = make('div', 'vote-named');
      if (m.setup) { about.appendChild(make('p', 'vote-setup', m.setup)); }
      var where = tryBox(m, 'h4');
      if (where) { about.appendChild(where); }
      about.appendChild(detailsBox(r.model, { lead: true, more: true }));
      body.appendChild(about);
      li.appendChild(body);
      readEl.appendChild(li);
    });
    likedList.textContent = '';
    liked.forEach(function (key) {             // names and where to try them; the whole card is in the comparison above
      likedList.appendChild(named(key));
    });
    likedBox.hidden = !liked.length;
  }
  function shortText(text, most) {
    text = String(text).replace(/\s+/g, ' ').trim();
    if (text.length <= most) { return text; }
    var cut = text.slice(0, most - 1), at = cut.lastIndexOf(' ');
    return (at > most / 2 ? cut.slice(0, at) : cut) + '…';
  }
  function nameLine(key) {
    var m = cfg.models[key] || { name: key }, p = make('p', 'vote-who-line');
    p.appendChild(make('strong', 'vote-name', m.name));
    if (m.setup) { p.appendChild(make('span', 'vote-setup', m.setup)); }
    return p;
  }
  function likedText() {
    var lines = ['Models I liked on Friends of 4o (friendsof4o.com/vote/)', ''];
    liked.forEach(function (key) {
      var m = cfg.models[key];
      lines.push(fullName(m) + (m.maker ? ' (' + m.maker + ')' : ''));
      lines.push('  What was tested: ' + m.tested);
      lines = lines.concat(tryText(m));
      lines.push('');
    });
    return lines.join('\n').replace(/\n+$/, '\n');
  }
  function onCopy() {
    var text = likedText();
    function shown() {                         // the browser would not copy: show the text to copy by hand
      copyText.value = text;
      copyText.hidden = false;
      copyText.focus();
      copyText.select();
      copyStatus.textContent = 'Copying did not work here. The list is in the box below.';
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) { shown(); return; }
    navigator.clipboard.writeText(text).then(function () { copyStatus.textContent = 'Copied.'; }, shown);
  }

  function finish() {
    var n = rounds.length, i;
    current = null;
    readLead.textContent = !n ? 'No comparisons this time.' : n === 1 ? 'One comparison helps. Here it is, with the name.'
      : 'Here are your comparisons, with the names.';
    var next = n < cfg.rounds_first ? cfg.rounds_first : cfg.rounds_max;
    moreBtn.hidden = !n || n >= cfg.rounds_max;
    moreWords.textContent = (WORDS[next - n] ? WORDS[next - n].charAt(0).toUpperCase() + WORDS[next - n].slice(1) : String(next - n)) + ' more';
    moreBtn.setAttribute('data-to', String(next));
    againBtn.hidden = !moreBtn.hidden;
    copyStatus.textContent = '';
    copyText.hidden = true;
    if (n) { opened = true; recapShown = true; }       // the list names every model that was read
    show('thanks');
    drawRecap();
    toTop('thanks');                                   // again, now that the list has its length
    // one call says the names were shown; it marks every saved vote of the sitting, and waits its turn behind
    // each vote's own calls
    for (i = 0; i < rounds.length; i++) { rounds[i].recapWanted = true; }
    if (n) { Promise.all(rounds.map(function (r) { return r.chain; })).then(function () {
      for (var k = 0; k < rounds.length; k++) { if (rounds[k].state === 'saved' && !rounds[k].recapSent) { queue(rounds[k]); return; } }
    }); }
  }

  for (var b = 0; b < choiceBtns.length; b++) { choiceBtns[b].addEventListener('click', onVote); }
  for (var p = 0; p < prefBtns.length; p++) { prefBtns[p].addEventListener('click', onPref); }
  whoBtn.addEventListener('click', onWho);
  retryBtn.addEventListener('click', function () { if (current && current.n && canRetry(current)) { saveVote(current); } });
  nextBtn.addEventListener('click', function () { leave(nextRound); });
  skipBtn.addEventListener('click', function () { if (current && !current.n) { skipped = true; nextRound(); } });
  finishBtn.addEventListener('click', function () { leave(finish); });
  moreBtn.addEventListener('click', function () { target = Number(moreBtn.getAttribute('data-to')) || cfg.rounds_max; nextRound(); });
  againBtn.addEventListener('click', startSitting);
  copyBtn.addEventListener('click', onCopy);
  all('[data-exp]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (experience) { return; }
      experience = button.getAttribute('data-exp');
      startSitting();
    });
  });
  startBtn.addEventListener('click', function () {
    loadFail.hidden = true;
    stepIn();
    if (experience) { startSitting(); } else { show('exp'); }
  });
  backEl.addEventListener('click', goBack);
  homeLink.addEventListener('click', goBack);

  getSettings().then(function (s) {
    cfg = s;
    startBtn.disabled = false;
  }).catch(function () { loadFail.hidden = false; });
})();
