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

  var qSelect = box.querySelector('[data-q-select]');
  var qEl = box.querySelector('[data-q]');
  var qFacts = box.querySelector('[data-q-facts]');
  var cols = { left: box.querySelector('[data-side="left"]'), right: box.querySelector('[data-side="right"]') };

  var index = null, models = Object.create(null), order = [], groupName = Object.create(null);
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
  function writeAddress() {
    var p = new URLSearchParams();
    p.set('q', state.q);
    if (state.l !== REF) { p.set('l', state.l); if (state.li) { p.set('li', '1'); } }
    p.set('m', state.m);
    if (state.i) { p.set('i', '1'); }
    if (state.a > 1 && state.l === REF) { p.set('a', String(state.a)); }
    try { window.history.replaceState(null, '', '?' + p.toString()); } catch (e) { /* a file opened from disk */ }
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
    var clamp = clampable && a.words > LONG;
    return (a.cut ? '<p class="none-yet">This answer was cut off at the length limit.</p>' : '') +
      '<div class="answer-text' + (clamp ? ' clamp' : '') + '" data-text>' + a.html + '</div>' +
      (clamp ? '<button class="btn btn-line btn-small" type="button" data-unclamp>Show the whole answer</button>' : '');
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
      draw();
    });
    col.querySelector('[data-seg]').addEventListener('change', function (ev) {
      if (side === 'left') { state.li = ev.target.value === '1' ? 1 : 0; } else { state.i = ev.target.value === '1' ? 1 : 0; }
      draw();
    });
    col.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-unclamp]');
      if (!b) { return; }
      var text = b.parentNode.querySelector('[data-text]');
      if (text) { text.classList.remove('clamp'); }
      b.hidden = true;
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
      var marked = body.querySelector('[data-marked]');
      if (marked) { marked.scrollIntoView({ block: 'start' }); }
    }).catch(function () {
      body.removeAttribute('data-filled');
      body.innerHTML = '<p class="none-yet">These answers could not be loaded. Close this and open it again to retry.</p>';
    });
  }

  /* ---- the whole view ---- */
  function draw() {
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
      writeAddress();
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
    draw();
  }

  F.getJSON('index.json').then(function (data) {
    index = data;
    data.models.forEach(function (m) { models[m.key] = m; order.push(m.key); });
    data.groups.forEach(function (g) { groupName[g.id] = g.name; });
    var prompts = Object.create(null);
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
    readAddress();
    if (!state.q || !prompts[state.q]) { state.q = data.questions[0].id; }
    if (!state.m || !models[state.m]) { state.m = models['gpt6-luna'] ? 'gpt6-luna' : null; }
    qSelect.addEventListener('change', function () { state.q = qSelect.value; state.a = 0; draw(); });
    box.querySelector('[data-prev]').addEventListener('click', function () { step(-1); });
    box.querySelector('[data-next]').addEventListener('click', function () { step(1); });
    draw();
  }).catch(function () {
    qEl.textContent = 'The answers could not be loaded. Please try again in a moment.';
  });
})();
