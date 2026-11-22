/* Friends of 4o: "Does it sound like 4o?"
   One answer is always the first archived answer from ChatGPT's own GPT-4o. The other is another model's
   answer to the same question. The sides are shuffled and nothing is named until the reader picks.
   The other model is sometimes one of GPT-4o's two versions on OpenAI's API. So the question, the buttons and
   the result always name the archived side in full, "ChatGPT's own GPT-4o", and never "GPT-4o" alone.

   On the home page (data-game="home") one round is written into the page, so it works without this script; the
   script makes it playable and puts the two answers in a random order. Nothing more is fetched on load; after a
   round, "Another round" fetches the short home rounds (home-rounds.json) once, only when it is pressed.
   On the game's own page (data-game="full") rounds are drawn from every question the game may use. After the
   guess, and before any name is shown, the reader is asked which answer they preferred; then the names show.
   Neither the guess nor the preference is recorded (see recordPick in site.js).
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
  var preferBar = el.querySelector('[data-prefer-bar]');
  var preferAsk = el.querySelector('[data-prefer-ask]');
  var guessEl = el.querySelector('[data-guess]');
  var preferBtns = Array.prototype.slice.call(el.querySelectorAll('[data-prefer-pick]'));
  var pickBtns = Array.prototype.slice.call(el.querySelectorAll('[data-pick]'));
  var febNote = el.querySelector('[data-feb-note]');
  if (cards.length !== 2 || !qEl) { return; }

  var current = null;          // { id, other, otherCondition }
  var done = true;
  var chosen = -1;             // the guess: 0 or 1 for an answer, -1 for Can't tell
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
  function fitCards() {
    for (var n = 0; n < cards.length; n++) {
      var label = cards[n].querySelector('[data-answer-label]');
      fitAnswer(cards[n].querySelector('[data-answer-text]'), label ? Math.min(6, Number(label.tagName.charAt(1)) + 1) : 3);
    }
  }

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
    fitCards();
    qEl.textContent = '“' + round.prompt + '”';
    qEl.classList.toggle('q-long', round.prompt.length > 150);
    current = { id: round.id, other: round.other.model, otherCondition: round.other.condition };
    el.setAttribute('data-question', round.id);
    if (febNote) { febNote.hidden = !round.feb; }   // the note on the February instruction, only when it was used
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
    for (var p = 0; p < preferBtns.length; p++) { preferBtns[p].setAttribute('aria-pressed', 'false'); preferBtns[p].disabled = false; }
    if (preferBar) { preferBar.hidden = true; }
    if (before) { before.hidden = false; }
    if (result) { result.hidden = true; }
    el.setAttribute('data-state', 'ready');
  }

  /* ---- the reader guesses ---- */
  function onPick(ev) {
    if (done) { return; }
    done = true;
    var button = ev.currentTarget;
    var value = button.getAttribute('data-pick');
    var card = button.closest('[data-answer]');
    chosen = card ? cards.indexOf(card) : (value === '0' ? 0 : value === '1' ? 1 : -1);   // -1: "Can't tell"
    current = current || { id: el.getAttribute('data-question') || '', other: el.getAttribute('data-other') || '',
      otherCondition: el.getAttribute('data-other-condition') || '' };
    current.picked = chosen < 0 ? 'cannot-tell' : cards[chosen].getAttribute('data-is4o') === 'true' ? 'gpt4o' : 'other';
    F.recordPick({ question: current.id, other: current.other, otherCondition: current.otherCondition, picked: current.picked });
    if (!preferBar) { reveal(); return; }
    // the game's own page: which answer did you prefer? asked before any name is shown
    for (var b = 0; b < pickBtns.length; b++) { pickBtns[b].disabled = true; }
    if (before) { before.hidden = true; }
    if (guessEl) { guessEl.textContent = chosen < 0 ? "Your guess: Can't tell." : 'Your guess: Answer ' + (chosen + 1) + '.'; }
    preferBar.hidden = false;
    el.setAttribute('data-state', 'prefer');
    if (preferAsk) {
      preferAsk.setAttribute('tabindex', '-1');
      preferAsk.focus({ preventScroll: true });
    }
  }
  for (var b = 0; b < pickBtns.length; b++) { pickBtns[b].addEventListener('click', onPick); }

  /* ---- the names: shown after the guess (on the game's own page, after the preference too) ---- */
  function reveal() {
    var number4o = 0, numberOther = 0, otherName = '';
    for (var n = 0; n < cards.length; n++) {
      var is4o = cards[n].getAttribute('data-is4o') === 'true';
      if (is4o) { number4o = n + 1; } else {
        numberOther = n + 1;
        var named = cards[n].querySelector('[data-who] strong');
        otherName = named ? named.textContent.replace(/\s+/g, ' ').trim() : '';
      }
      cards[n].setAttribute('data-shown', is4o ? 'gpt4o' : 'other');
      if (n === chosen) { cards[n].setAttribute('data-picked', ''); }
      cards[n].querySelector('[data-who]').hidden = false;
    }
    for (var b = 0; b < pickBtns.length; b++) { if (pickBtns[b].closest('[data-answer]')) { pickBtns[b].hidden = true; } }
    if (before) { before.hidden = true; }
    if (preferBar) { preferBar.hidden = true; }
    var picked = current.picked;
    // the result names both sides, so a reader on a phone need not scroll back up to see the other model (D42)
    F.setText(resultText, (picked === 'gpt4o' ? 'Yes. ' : picked === 'other' ? 'No. ' : '') +
      'Answer ' + number4o + ' came from ' + ARCHIVED + '.' +
      (otherName ? ' Answer ' + numberOther + ' came from ' + otherName + '.' : ''));
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
  }

  /* ---- before the names: which answer did you prefer? ---- */
  for (var p = 0; p < preferBtns.length; p++) {
    preferBtns[p].addEventListener('click', function (ev) {
      if (el.getAttribute('data-state') !== 'prefer') { return; }
      var value = ev.currentTarget.getAttribute('data-prefer-pick');
      for (var i = 0; i < preferBtns.length; i++) {
        preferBtns[i].setAttribute('aria-pressed', preferBtns[i] === ev.currentTarget ? 'true' : 'false');
      }
      var preferred = 'none';
      if (value === '0' || value === '1') {
        preferred = cards[Number(value)].getAttribute('data-is4o') === 'true' ? 'gpt4o' : 'other';
      }
      F.recordPick({ question: current.id, other: current.other, otherCondition: current.otherCondition,
        picked: current.picked, preferred: preferred });
      reveal();
    });
  }

  /* ---- home page: one short round; "Another round" fetches one more, only when pressed ---- */
  if (mode === 'home') {
    // The round written into the page is the one played first; its two answers are put in a random order.
    if (Math.random() < 0.5) {
      var a = cards[0].querySelector('[data-answer-text]'), z = cards[1].querySelector('[data-answer-text]');
      var wa = cards[0].querySelector('[data-who]'), wz = cards[1].querySelector('[data-who]');
      var html = a.innerHTML; a.innerHTML = z.innerHTML; z.innerHTML = html;
      var who = wa.innerHTML; wa.innerHTML = wz.innerHTML; wz.innerHTML = who;
      cards[0].setAttribute('data-is4o', 'false');
      cards[1].setAttribute('data-is4o', 'true');
    }
    fitCards();
    current = { id: el.getAttribute('data-question'), other: el.getAttribute('data-other'),
      otherCondition: el.getAttribute('data-other-condition') };
    ready();
    var another = el.querySelector('[data-another]');
    var anotherFail = el.querySelector('[data-another-fail]');
    var homeRounds = null;
    if (another) {
      another.hidden = false;
      another.addEventListener('click', function () {
        another.disabled = true;
        if (anotherFail) { anotherFail.hidden = true; }
        (homeRounds || F.getJSON('home-rounds.json')).then(function (data) {
          homeRounds = Promise.resolve(data);
          var pairs = [];
          (data.rounds || []).forEach(function (r) {
            (r.others || []).forEach(function (o) {
              if (!(r.id === current.id && o.model === current.other && o.condition === current.otherCondition)) { pairs.push([r, o]); }
            });
          });
          if (!pairs.length) { throw new Error('no other round'); }
          var p = pick(pairs), r = p[0], o = p[1];
          show({ id: r.id, prompt: r.prompt,
            four: { html: r.chatgpt.html, who: whoFourO(r.chatgpt) },
            other: { html: o.html, who: whoOther((data.names || {})[o.model] || o.model, o.asked, o.condition), model: o.model, condition: o.condition },
            feb: !!r.chatgpt.instruction || o.condition === 'instruction' });
          another.disabled = false;
          el.scrollIntoView({ block: 'start' });
          qEl.setAttribute('tabindex', '-1');
          qEl.focus({ preventScroll: true });
        }).catch(function () {
          homeRounds = null;                 // a failed load is not kept, so the next press tries again
          another.disabled = false;
          if (anotherFail) { anotherFail.hidden = false; }
        });
      });
    }
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
