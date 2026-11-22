/* Friends of 4o: "Does it sound like 4o?"
   One answer is always the first archived answer from ChatGPT's own GPT-4o. The other is another model's
   answer to the same question. The sides are shuffled and nothing is named until the reader picks.
   The other model is sometimes one of GPT-4o's two versions on OpenAI's API. So the question, the buttons and
   the result always name the archived side in full, "ChatGPT's own GPT-4o", and never "GPT-4o" alone.

   On the home page (data-game="home") one round is already written into the page, so it works without this
   script; with it, a different short round is drawn on each visit.
   On the game's own page (data-game="full") rounds are drawn from every question the game may use.
*/
(function () {
  'use strict';

  var F = window.Fo4o;
  var el = document.querySelector('[data-game]');
  if (!F || !el) { return; }

  var mode = el.getAttribute('data-game');
  var cards = Array.prototype.slice.call(el.querySelectorAll('[data-answer]'));
  var qEl = el.querySelector('[data-q]');
  var before = el.querySelector('[data-before-pick]');
  var result = el.querySelector('[data-result]');
  var resultText = el.querySelector('[data-result-text]');
  var tallyEl = el.querySelector('[data-tally]');
  var nextBtn = el.querySelector('[data-next]');
  var preferBtns = Array.prototype.slice.call(el.querySelectorAll('[data-prefer-pick]'));
  var pickBtns = Array.prototype.slice.call(el.querySelectorAll('[data-pick]'));
  if (cards.length !== 2 || !qEl) { return; }

  var current = null;          // { id, other, otherCondition }
  var done = true;
  var tally = { rounds: 0, right: 0, unsure: 0 };

  /* ---- who said it: the same words the build writes into the home page ---- */
  var ARCHIVED = "ChatGPT's own GPT-4o";     // the side the round asks for, named the same everywhere
  function whoFourO(c) {
    var text = 'Asked on ' + F.usDate(c.asked);
    if (c.instruction) {
      text += ', with the February instruction' +
        (c.temperature === null || c.temperature === undefined ? '' : ', temperature ' + c.temperature) + '.';
    } else {
      text += '. No instruction recorded.';
    }
    return { strong: ARCHIVED, text: text };
  }
  function whoOther(name, asked, condition) {
    var when = condition === 'plain' ? 'asked plainly on ' + F.usDate(asked)
      : 'asked on ' + F.usDate(asked) + ', with the February instruction';
    // One of GPT-4o's own versions on OpenAI's API: both sides of the round are GPT-4o, so say plainly which this is.
    if (/^GPT-4o \((.+) version\)$/.test(name)) { return { strong: name, text: "Through OpenAI's API, " + when + '.' }; }
    return { strong: name, text: when.charAt(0).toUpperCase() + when.slice(1) + '.' };
  }
  function setWho(node, who) {
    node.textContent = '';
    var strong = document.createElement('strong');
    F.setText(strong, who.strong);
    node.appendChild(strong);
    var rest = document.createElement('span');
    F.setText(rest, ' ' + who.text);
    node.appendChild(rest);
  }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* ---- put a round on the page ---- */
  function show(round) {
    // round = { id, prompt, four: { html, who }, other: { html, who, model, condition } }
    var sides = Math.random() < 0.5 ? [round.four, round.other] : [round.other, round.four];
    for (var n = 0; n < cards.length; n++) {
      var card = cards[n];
      card.setAttribute('data-is4o', sides[n] === round.four ? 'true' : 'false');
      card.removeAttribute('data-shown');
      card.removeAttribute('data-picked');
      card.querySelector('[data-answer-text]').innerHTML = sides[n].html;     // built by our own build, from the data
      var who = card.querySelector('[data-who]');
      setWho(who, sides[n].who);
      who.hidden = true;
      card.querySelector('[data-answer-label]').textContent = 'Answer ' + (n + 1);
    }
    qEl.textContent = '“' + round.prompt + '”';
    qEl.classList.toggle('q-long', round.prompt.length > 150);
    current = { id: round.id, other: round.other.model, otherCondition: round.other.condition };
    el.setAttribute('data-question', round.id);
    ready();
  }

  function ready() {
    done = false;
    for (var n = 0; n < cards.length; n++) {
      cards[n].removeAttribute('data-shown');
      cards[n].removeAttribute('data-picked');
      cards[n].querySelector('[data-who]').hidden = true;
    }
    for (var b = 0; b < pickBtns.length; b++) {
      pickBtns[b].hidden = false;
      pickBtns[b].disabled = false;
      var card = pickBtns[b].closest('[data-answer]');
      if (card) { pickBtns[b].setAttribute('aria-label', 'This one came from ' + ARCHIVED + ' (answer ' + (cards.indexOf(card) + 1) + ')'); }
    }
    for (var p = 0; p < preferBtns.length; p++) { preferBtns[p].setAttribute('aria-pressed', 'false'); }
    if (before) { before.hidden = false; }
    if (result) { result.hidden = true; }
    el.setAttribute('data-state', 'ready');
  }

  /* ---- the reader picks ---- */
  function onPick(ev) {
    if (done) { return; }
    done = true;
    var button = ev.currentTarget;
    var value = button.getAttribute('data-pick');
    var card = button.closest('[data-answer]');
    var chosen = card ? cards.indexOf(card) : (value === '0' ? 0 : value === '1' ? 1 : -1);   // -1: "Can't tell"
    var picked = 'cannot-tell';
    var number4o = 0;
    for (var n = 0; n < cards.length; n++) {
      var is4o = cards[n].getAttribute('data-is4o') === 'true';
      if (is4o) { number4o = n + 1; }
      cards[n].setAttribute('data-shown', is4o ? 'gpt4o' : 'other');
      if (n === chosen) { cards[n].setAttribute('data-picked', ''); picked = is4o ? 'gpt4o' : 'other'; }
      cards[n].querySelector('[data-who]').hidden = false;
    }
    for (var b = 0; b < pickBtns.length; b++) { if (pickBtns[b].closest('[data-answer]')) { pickBtns[b].hidden = true; } }
    if (before) { before.hidden = true; }
    F.setText(resultText, (picked === 'gpt4o' ? 'Yes. ' : picked === 'other' ? 'No. ' : '') +
      'Answer ' + number4o + ' came from ' + ARCHIVED + '.');
    tally.rounds += 1;
    if (picked === 'gpt4o') { tally.right += 1; }
    if (picked === 'cannot-tell') { tally.unsure += 1; }
    if (tallyEl) {
      tallyEl.textContent = 'This visit: ' + tally.rounds + (tally.rounds === 1 ? ' round, ' : ' rounds, ') +
        tally.right + ' right' + (tally.unsure ? ', ' + tally.unsure + " can't tell" : '') + '.';
    }
    if (result) {
      result.hidden = false;
      resultText.setAttribute('tabindex', '-1');
      resultText.focus({ preventScroll: mode === 'home' });
    }
    el.setAttribute('data-state', 'done');
    el.setAttribute('data-picked', picked);
    current = current || { id: el.getAttribute('data-question') || '', other: el.getAttribute('data-other') || '',
      otherCondition: el.getAttribute('data-other-condition') || '' };
    current.picked = picked;
    F.recordPick({ question: current.id, other: current.other, otherCondition: current.otherCondition, picked: picked });
  }
  for (var b = 0; b < pickBtns.length; b++) { pickBtns[b].addEventListener('click', onPick); }

  /* ---- after the reveal: which answer did you prefer? (optional) ---- */
  for (var p = 0; p < preferBtns.length; p++) {
    preferBtns[p].addEventListener('click', function (ev) {
      var value = ev.currentTarget.getAttribute('data-prefer-pick');
      for (var i = 0; i < preferBtns.length; i++) {
        preferBtns[i].setAttribute('aria-pressed', preferBtns[i] === ev.currentTarget ? 'true' : 'false');
      }
      var preferred = 'none';
      if (value === '0' || value === '1') {
        preferred = cards[Number(value)].getAttribute('data-is4o') === 'true' ? 'gpt4o' : 'other';
      }
      if (current) {
        F.recordPick({ question: current.id, other: current.other, otherCondition: current.otherCondition,
          picked: current.picked, preferred: preferred });
      }
    });
  }

  /* ---- home page: one short round, a different one on each visit ---- */
  if (mode === 'home') {
    // A different round is drawn before the buttons appear. If it is slow or fails, the round written into the
    // page is made ready to play instead, and it stays for this visit: a round is never swapped once playable.
    var settled = false;
    var useWritten = function () {
      if (settled) { return; }
      settled = true;
      var written = { id: el.getAttribute('data-question'), other: el.getAttribute('data-other'),
        otherCondition: el.getAttribute('data-other-condition') };
      if (Math.random() < 0.5) {
        var a = cards[0].querySelector('[data-answer-text]'), z = cards[1].querySelector('[data-answer-text]');
        var wa = cards[0].querySelector('[data-who]'), wz = cards[1].querySelector('[data-who]');
        var html = a.innerHTML; a.innerHTML = z.innerHTML; z.innerHTML = html;
        var who = wa.innerHTML; wa.innerHTML = wz.innerHTML; wz.innerHTML = who;
        cards[0].setAttribute('data-is4o', 'false');
        cards[1].setAttribute('data-is4o', 'true');
      }
      current = written;
      ready();
    };
    setTimeout(useWritten, 1500);
    F.getJSON('home-rounds.json').then(function (data) {
      if (settled || !data.rounds || !data.rounds.length) { useWritten(); return; }
      var r = pick(data.rounds);
      var o = pick(r.others);
      var round = { id: r.id, prompt: r.prompt,
        four: { html: r.chatgpt.html, who: whoFourO(r.chatgpt) },
        other: { html: o.html, who: whoOther(data.names[o.model] || o.model, o.asked, o.condition),
          model: o.model, condition: o.condition } };
      settled = true;
      show(round);
    }).catch(useWritten);
    return;
  }

  /* ---- the game's own page ---- */
  var names = {};
  var questions = [];
  var queue = [];

  function fail() {
    qEl.textContent = 'The answers could not be loaded. Please try again in a moment.';
    for (var i = 0; i < pickBtns.length; i++) { pickBtns[i].disabled = true; }
  }
  function nextRound(tries) {
    if (!queue.length) {
      queue = questions.slice();
      for (var i = queue.length - 1; i > 0; i--) {          // shuffle, so no question repeats until all are seen
        var j = Math.floor(Math.random() * (i + 1));
        var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
      }
    }
    var id = queue.pop();
    return F.getJSON('q/' + id + '.json').then(function (q) {
      var byModel = {};
      Object.keys(q.answers || {}).forEach(function (key) {
        ['plain', 'instruction'].forEach(function (cond) {
          var ans = q.answers[key][cond];
          if (ans && ans.game !== false && !ans.cut) { (byModel[key] = byModel[key] || []).push({ cond: cond, a: ans }); }
        });
      });
      var keys = Object.keys(byModel);
      if (!q.chatgpt || !keys.length) {
        if ((tries || 0) > 5) { throw new Error('no playable question'); }
        return nextRound((tries || 0) + 1);
      }
      var key = pick(keys);                                  // a model first, then one of its two ways of being asked
      var o = pick(byModel[key]);
      show({ id: q.id, prompt: q.prompt,
        four: { html: q.chatgpt.html, who: whoFourO(q.chatgpt) },
        other: { html: o.a.html, who: whoOther(names[key] || key, o.a.asked, o.cond), model: key, condition: o.cond } });
    });
  }

  Promise.all([F.getJSON('game.json'), F.getJSON('index.json')]).then(function (got) {
    questions = got[0].questions || [];
    (got[1].models || []).forEach(function (m) { names[m.key] = m.name; });
    if (!questions.length) { throw new Error('no questions'); }
    return nextRound(0);
  }).catch(fail);

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      nextBtn.disabled = true;
      nextRound(0).then(function () {
        nextBtn.disabled = false;
        el.scrollIntoView({ block: 'start' });
        qEl.focus({ preventScroll: true });
      }).catch(function () { nextBtn.disabled = false; fail(); });
    });
  }
})();
