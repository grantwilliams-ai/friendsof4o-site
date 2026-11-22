/* Friends of 4o: "Compare GPT-4o with other models".
   Pick a question; read GPT-4o's answer on the left beside any model's answer on the right, asked plainly or
   after the February instruction. Four simple counts sit beside each answer. No verdicts.

   The address keeps the view, so a view can be shared:
     ?q=q26          the question
     &l=chatgpt      the left side: chatgpt (ChatGPT's own GPT-4o) or one of GPT-4o's API versions
     &li=1           the left side's February instruction, for an API version (0 off, 1 on)
     &m=gpt6-luna    the right side's model
     &i=1            the right side's February instruction (0 off, 1 on)
     &a=10           open the tenth archived answer from ChatGPT's own GPT-4o
   Each choice the reader makes (question, model, instruction) is a step that Back undoes; a shared link opens
   straight at its view, and Back from there leaves the page as usual.
*/
(function () {
  'use strict';

  var F = window.Fo4o;
  var box = document.querySelector('[data-compare]');
  if (!F || !box) { return; }

  var REF = 'chatgpt';
  var askedNotes = {};         // one short line for a model and a way of asking, from content/models.json
  try { askedNotes = JSON.parse(box.getAttribute('data-asked-notes') || '{}'); } catch (e) { askedNotes = {}; }
  var GROUP_LABEL = {
    'GPT-4o': "GPT-4o on OpenAI's API",
    'current model': 'Current models',
    'open model': 'Open models',
    'open model said to be trained to sound like GPT-4o': 'Open models said to be trained to sound like GPT-4o'
  };
  var LONG = 220;              // words; longer answers are shortened on a phone, with a button to show the rest
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 899px)') : { matches: false };
  var cutN = 0;

  var qSelect = box.querySelector('[data-q-select]');
  var qEl = box.querySelector('[data-q]');
  var qFacts = box.querySelector('[data-q-facts]');
  var cols = { left: box.querySelector('[data-side="left"]'), right: box.querySelector('[data-side="right"]') };

  var index = null, models = Object.create(null), order = [], groupName = Object.create(null), prompts = Object.create(null);
  var files = Object.create(null), extras = Object.create(null);
  var state = { q: null, l: REF, li: 0, m: null, i: 0, a: 0 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function names(s) {          // escaped text, with names such as GPT-4o kept on one line
    return esc(s).replace(/GPT-\d[\w.]*(?: (?:Luna|Sol|Astra))?/g, '<span class="nb">$&</span>');
  }
  function short(text, n) {
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length <= n) { return text; }
    return text.slice(0, n).replace(/\s+\S*$/, '') + ' …';
  }
  function cached(store, id, path) {   // keep a request; forget a failed one, so a later try fetches again
    if (!store[id]) {
      var wait = store[id] = F.getJSON(path);
      wait.catch(function () { if (store[id] === wait) { delete store[id]; } });
    }
    return store[id];
  }
  // An answer keeps its own words. On this page its own headings sit one level under the heading above it, in the
  // same order, and contents links that point to no place in the answer are shown as plain text.
  function fitAnswer(node, top) {
    if (!node) { return; }
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
  function countWords(text) { return text.split(/\s+/).filter(Boolean).length; }
  // On a phone a long answer shows its first part; the rest is truly hidden (not read aloud, not reached by the
  // keyboard) until the button is pressed. The cut falls between paragraphs, lists or headings, never inside one.
  function cutShort(text) {
    var kids = Array.prototype.slice.call(text.childNodes), words = 0, keep = 0, total = countWords(text.textContent);
    for (var i = 0; i < kids.length; i++) {
      var w = countWords(kids[i].textContent || '');
      if (w && keep && words + w > LONG) { break; }
      words += w;
      keep = i + 1;
    }
    // the shown part never ends on a heading, a rule or a blank: those go with the part they lead into
    while (keep > 1 && (kids[keep - 1].nodeType !== 1 ? !/\S/.test(kids[keep - 1].textContent) : /^(H[1-6]|HR)$/.test(kids[keep - 1].tagName))) {
      keep -= 1;
      words -= countWords(kids[keep].textContent || '');
    }
    if (keep >= kids.length || total - words < 40) { return; }      // little or nothing left over: show it whole
    var rest = document.createElement('div');
    rest.id = 'answer-rest-' + (++cutN);
    rest.className = 'answer-rest';
    rest.hidden = true;
    rest.setAttribute('tabindex', '-1');
    for (var j = keep; j < kids.length; j++) { rest.appendChild(kids[j]); }
    text.appendChild(rest);
    var b = document.createElement('button');
    b.className = 'btn btn-line btn-small';
    b.type = 'button';
    b.setAttribute('data-unclamp', '');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', rest.id);
    b.textContent = 'Show the whole answer';
    text.parentNode.insertBefore(b, text.nextSibling);
  }
  function showRest(b, focus) {
    var rest = document.getElementById(b.getAttribute('aria-controls'));
    if (rest) { rest.hidden = false; }
    b.setAttribute('aria-expanded', 'true');
    b.hidden = true;
    if (rest && focus) { rest.focus(); }
  }
  // a phone turned sideways, or a window made wide: the answers are shown whole there
  function onWidth() {
    if (narrow.matches) { return; }
    Array.prototype.forEach.call(box.querySelectorAll('[data-unclamp]'), function (b) { showRest(b, false); });
  }
  if (narrow.addEventListener) { narrow.addEventListener('change', onWidth); } else if (narrow.addListener) { narrow.addListener(onWidth); }

  /* ---- on a phone, two tabs: one answer at a time, GPT-4o or the other model (D41) ---- */
  var tabBar = box.querySelector('[data-tabs]');
  var tabs = tabBar ? Array.prototype.slice.call(tabBar.querySelectorAll('[data-tab]')) : [];
  function setTab(which, focus) {
    box.setAttribute('data-tab', which);
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === which;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus) { t.focus(); }
    });
    // read down one answer, switch, and the other starts at its top, just under the tabs
    var g = tabBar.nextElementSibling.getBoundingClientRect().top;
    if (narrow.matches && g < tabBar.offsetHeight) { window.scrollBy(0, g - tabBar.offsetHeight - 4); }
  }
  // the columns are tab panels only while the tabs show
  function tabRoles() {
    ['left', 'right'].forEach(function (side) {
      if (narrow.matches) { cols[side].setAttribute('role', 'tabpanel'); cols[side].setAttribute('aria-labelledby', 'cmp-tab-' + side); }
      else { cols[side].removeAttribute('role'); cols[side].removeAttribute('aria-labelledby'); }
    });
  }
  if (tabBar) {
    tabBar.hidden = false;
    box.setAttribute('data-tab', 'left');
    tabRoles();
    if (narrow.addEventListener) { narrow.addEventListener('change', tabRoles); } else if (narrow.addListener) { narrow.addListener(tabRoles); }
    tabs.forEach(function (t) { t.addEventListener('click', function () { setTab(t.getAttribute('data-tab'), false); }); });
    tabBar.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') { return; }
      ev.preventDefault();
      var now = box.getAttribute('data-tab');
      setTab(ev.key === 'Home' ? 'left' : ev.key === 'End' ? 'right' : (now === 'left' ? 'right' : 'left'), true);
    });
  }
  function tabName(side, name) {
    var t = tabBar && tabBar.querySelector('[data-tab="' + side + '"]');
    if (t && side === 'right') { t.innerHTML = names(name); }
  }

  function load(id) { return cached(files, id, 'q/' + id + '.json'); }
  function loadExtras(id) { return cached(extras, id, 'q/' + id + '.more.json'); }

  /* ---- the address ---- */
  function readAddress() {
    var p = new URLSearchParams(window.location.search);
    if (p.get('q')) { state.q = p.get('q'); }
    if (p.get('l')) { state.l = p.get('l'); }
    if (p.get('m')) { state.m = p.get('m'); }
    state.li = p.get('li') === '1' ? 1 : 0;
    state.i = p.get('i') === '1' ? 1 : 0;
    state.a = Math.max(0, parseInt(p.get('a') || '0', 10) || 0);
  }
  function writeAddress(push) {
    var p = new URLSearchParams();
    p.set('q', state.q);
    if (state.l !== REF) { p.set('l', state.l); if (state.li) { p.set('li', '1'); } }
    p.set('m', state.m);
    if (state.i) { p.set('i', '1'); }
    if (state.a > 1 && state.l === REF) { p.set('a', String(state.a)); }
    var to = '?' + p.toString();
    try {
      if (push && to !== window.location.search) { window.history.pushState(null, '', to); }
      else { window.history.replaceState(null, '', to); }
    } catch (e) { /* a file opened from disk */ }
  }

  /* ---- what each side says about its answer ---- */
  function measures(a) {
    function yes(v) { return v ? 'Yes' : 'No'; }
    return '<dl class="measures">' +
      '<div><dt>Words</dt><dd>' + Number(a.words).toLocaleString('en-US') + '</dd></div>' +
      '<div><dt>Lists</dt><dd>' + yes(a.list) + '</dd></div>' +
      '<div><dt>Headings</dt><dd>' + yes(a.heading) + '</dd></div>' +
      '<div><dt>Ends with a question</dt><dd>' + yes(a.question) + '</dd></div>' +
      '</dl>';
  }
  function askedLine(key, a, cond) {
    var how = (key === REF ? index.reference.how : models[key].how) + ' on ' + F.usDate(a.asked);
    if (key === REF) {
      if (a.instruction) {
        return how + ', with the February instruction' +
          (a.temperature === null || a.temperature === undefined ? '' : ', temperature ' + a.temperature) + '.';
      }
      return how + '. No instruction recorded.';
    }
    return how + (cond === 'instruction' ? ', with the February instruction.' : ', asked plainly.');
  }
  function noteLine(key, cond) {
    var line = (askedNotes[key] || {})[cond];
    return line ? '<li data-asked-note>' + names(line) + '</li>' : '';
  }
  function modelLine(info) {
    return (info.maker ? 'By ' + info.maker + '. ' : '') + 'Weights: ' + info.weights + '. Thinking: ' +
      (info.thinking || 'not yet measured') + '.';
  }
  function answerBlock(a, clampable) {
    var cut = clampable && a.words > LONG && narrow.matches;
    return (a.cut ? '<p class="none-yet">This answer was cut off at the length limit.</p>' : '') +
      '<div class="answer-text" data-text' + (cut ? ' data-cut' : '') + '>' + a.html + '</div>';
  }

  /* ---- one side ---- */
  function frame(side) {
    var col = cols[side];
    col.innerHTML =
      '<div class="cmp-pick">' +
        '<div class="field"><label for="' + side + '-model">' + (side === 'left' ? 'GPT-4o' : 'Other model') + '</label>' +
          '<div class="select"><select id="' + side + '-model" data-model></select></div></div>' +
        '<fieldset class="seg" data-seg><legend>February instruction</legend>' +
          '<label><input type="radio" name="' + side + '-i" value="0"><span>Off</span></label>' +
          '<label><input type="radio" name="' + side + '-i" value="1"><span>On</span></label>' +
        '</fieldset>' +
      '</div>' +
      '<div data-out aria-live="polite"></div>';
    col.querySelector('[data-model]').addEventListener('change', function (ev) {
      if (side === 'left') { state.l = ev.target.value; state.a = 0; } else { state.m = ev.target.value; }
      draw(true);
    });
    col.querySelector('[data-seg]').addEventListener('change', function (ev) {
      if (side === 'left') { state.li = ev.target.value === '1' ? 1 : 0; } else { state.i = ev.target.value === '1' ? 1 : 0; }
      draw(true);
    });
    col.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-unclamp]');
      if (b) { showRest(b, true); }
    });
  }

  function fillModels(side, q) {
    var select = cols[side].querySelector('[data-model]');
    var html = '';
    if (side === 'left') {
      if (q.chatgpt) { html += '<option value="' + REF + '">' + esc(index.reference.name) + '</option>'; }
      index.model_groups.forEach(function (g) {
        if (g.name !== 'GPT-4o') { return; }
        g.models.forEach(function (key) {
          if (q.answers[key]) { html += '<option value="' + esc(key) + '">' + esc(models[key].name) + '</option>'; }
        });
      });
    } else {
      index.model_groups.forEach(function (g) {
        var inner = '';
        g.models.forEach(function (key) {
          if (!models[key]) { return; }
          inner += '<option value="' + esc(key) + '"' + (q.answers[key] ? '' : ' disabled') + '>' + esc(models[key].name) +
            (q.answers[key] ? '' : ' (no answer to this question)') + '</option>';
        });
        if (inner) { html += '<optgroup label="' + esc(GROUP_LABEL[g.name] || g.name) + '">' + inner + '</optgroup>'; }
      });
    }
    select.innerHTML = html;
    select.value = side === 'left' ? state.l : state.m;
  }

  function drawSide(side, q) {
    var col = cols[side];
    var key = side === 'left' ? state.l : state.m;
    var seg = col.querySelector('[data-seg]');
    var out = col.querySelector('[data-out]');
    var isRef = key === REF;
    seg.hidden = isRef;
    var cond = 'plain', a = null, info = null, moreCount = 0;
    if (isRef) {
      a = q.chatgpt; info = index.reference; moreCount = a ? a.more : 0;
    } else {
      var both = q.answers[key] || {};
      var want = (side === 'left' ? state.li : state.i) ? 'instruction' : 'plain';
      if (!both[want]) {                                   // only one way of asking is there: show that one
        want = both.plain ? 'plain' : 'instruction';
        if (side === 'left') { state.li = want === 'instruction' ? 1 : 0; } else { state.i = want === 'instruction' ? 1 : 0; }
      }
      cond = want; a = both[cond] || null; info = models[key];
      moreCount = ((q.more || {})[key] || {})[cond] || 0;
      var radios = seg.querySelectorAll('input');
      radios[0].checked = cond === 'plain'; radios[1].checked = cond === 'instruction';
      radios[0].disabled = !both.plain; radios[1].disabled = !both.instruction;
    }
    if (!a || !info) {
      out.innerHTML = '<p class="none-yet">There is no answer here for this question yet.</p>';
      return;
    }
    tabName(side, info.name);
    var more = '';
    if (moreCount > 0) {
      more = '<details class="fold" data-more><summary><span class="words">' +
        names(isRef ? "More answers from ChatGPT's own GPT-4o" : 'More answers from this model') + ' (' + moreCount + ')</span></summary>' +
        '<div class="fold-body" data-more-body></div></details>';
    }
    out.innerHTML =
      '<div><h2 class="cmp-name" id="' + side + '-name">' + names(info.name) + '</h2>' +
      '<ul class="cmp-facts"><li>' + names(modelLine(info)) + '</li><li>' + names(askedLine(key, a, cond)) + '</li>' +
      noteLine(key, cond) + '</ul></div>' +
      measures(a) + answerBlock(a, true) + more;
    var main = out.querySelector('[data-text]');
    fitAnswer(main, 3);
    if (main.hasAttribute('data-cut')) { cutShort(main); }
    var fold = out.querySelector('[data-more]');
    if (fold) {
      fold.addEventListener('toggle', function () {
        if (fold.open) { fillExtras(fold, side, q, key, cond, 1 + moreCount, 0); }
      });
      if (isRef && state.a > 1 && state.a <= 1 + moreCount) {
        fold.open = true;
        fillExtras(fold, side, q, key, cond, 1 + moreCount, state.a);
      }
    }
  }

  function fillExtras(fold, side, q, key, cond, total, mark) {
    var body = fold.querySelector('[data-more-body]');
    if (body.getAttribute('data-filled')) { return; }
    body.setAttribute('data-filled', '1');
    body.innerHTML = '<p class="none-yet">Loading.</p>';
    loadExtras(q.id).then(function (data) {
      var list = key === REF ? (data.chatgpt || []) : (((data.answers || {})[key] || {})[cond] || []);
      var html = '';
      list.forEach(function (a, n) {
        var number = n + 2;
        html += '<article class="extra" id="' + side + '-answer-' + number + '"' + (number === mark ? ' data-marked' : '') + '>' +
          '<h3>Answer ' + number + ' of ' + total + '</h3>' +
          '<ul class="cmp-facts"><li>' + names(askedLine(key, a, cond)) + '</li>' + noteLine(key, cond) + '</ul>' +
          measures(a) + answerBlock(a, false) + '</article>';
      });
      body.innerHTML = html || '<p class="none-yet">No more answers here.</p>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-text]'), function (t) { fitAnswer(t, 4); });
      var marked = body.querySelector('[data-marked]');
      if (marked) { marked.scrollIntoView({ block: 'start' }); }
    }).catch(function () {
      body.removeAttribute('data-filled');
      body.innerHTML = '<p class="none-yet">These answers could not be loaded. Close this and open it again to retry.</p>';
    });
  }

  /* ---- the whole view ---- */
  // push: the reader made a choice here, so Back can undo it
  function draw(push) {
    var id = state.q;
    load(id).then(function (q) {
      if (state.q !== id) { return; }                      // the reader has moved on
      // the left side is GPT-4o: ChatGPT's own where it answered, else an API version
      var leftOK = (state.l === REF && q.chatgpt) || (state.l !== REF && q.answers[state.l] && models[state.l] &&
        models[state.l].group === 'GPT-4o');
      if (!leftOK) {
        state.l = q.chatgpt ? REF : (index.model_groups.filter(function (g) { return g.name === 'GPT-4o'; })[0] || { models: [] })
          .models.filter(function (k) { return q.answers[k]; })[0];
      }
      if (!state.m || !q.answers[state.m]) {
        state.m = order.filter(function (k) { return q.answers[k] && k !== state.l && models[k].group !== 'GPT-4o'; })[0] ||
          order.filter(function (k) { return q.answers[k] && k !== state.l; })[0] ||
          order.filter(function (k) { return q.answers[k]; })[0];
      }
      qSelect.value = id;
      qEl.textContent = '“' + q.prompt + '”';
      qEl.classList.toggle('q-long', q.prompt.length > 150);
      var answered = Object.keys(q.answers).length;
      F.setText(qFacts, q.group.name + '. ' + (q.asked_of === 'all' ? 'Asked of every model' : 'Asked of GPT-4o only') +
        '. ' + answered + (answered === 1 ? ' model has' : ' models have') + ' answered it here.');
      fillModels('left', q);
      fillModels('right', q);
      drawSide('left', q);
      drawSide('right', q);
      writeAddress(push);
    }).catch(function () {
      if (state.q !== id) { return; }                      // the reader has moved on
      qEl.textContent = 'The answers could not be loaded. Please try again in a moment.';
    });
  }

  function step(by) {
    var ids = index.questions.map(function (q) { return q.id; });
    var at = ids.indexOf(state.q);
    state.q = ids[(at + by + ids.length) % ids.length];
    state.a = 0;
    draw(true);
  }
  // the view the address names, with the same choices filled in as on a first visit
  function fromAddress() {
    state = { q: null, l: REF, li: 0, m: null, i: 0, a: 0 };
    readAddress();
    if (!state.q || !prompts[state.q]) { state.q = index.questions[0].id; }
    if (!state.m || !models[state.m]) { state.m = models['gpt6-luna'] ? 'gpt6-luna' : null; }
  }

  F.getJSON('index.json').then(function (data) {
    index = data;
    data.models.forEach(function (m) { models[m.key] = m; order.push(m.key); });
    data.groups.forEach(function (g) { groupName[g.id] = g.name; });
    data.questions.forEach(function (q) { prompts[q.id] = q.prompt; });
    var html = '';
    data.groups.forEach(function (g) {
      html += '<optgroup label="' + esc(g.name) + '">';
      g.questions.forEach(function (id) { html += '<option value="' + esc(id) + '">' + esc(short(prompts[id], 84)) + '</option>'; });
      html += '</optgroup>';
    });
    qSelect.innerHTML = html;
    frame('left');
    frame('right');
    fromAddress();
    qSelect.addEventListener('change', function () { state.q = qSelect.value; state.a = 0; draw(true); });
    window.addEventListener('popstate', function () { fromAddress(); draw(false); });
    box.querySelector('[data-prev]').addEventListener('click', function () { step(-1); });
    box.querySelector('[data-next]').addEventListener('click', function () { step(1); });
    draw(false);
  }).catch(function () {
    qEl.textContent = 'The answers could not be loaded. Please try again in a moment.';
  });
})();
