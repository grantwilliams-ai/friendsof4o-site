/* Friends of 4o: the few things every page needs a script for.
   No requests to other sites, no storage in the browser, no tracking.

   Three hooks, one function each, so that Cloudflare Pages Functions (the functions/ folder) can be wired in
   later. They are kept apart on purpose: picks, mailing-list signups and suggestions never share a store.
     recordPick(pick)        called when a reader answers a round of the guessing game, and once more if they
                             then say which answer they preferred (same round, with `preferred` added)
     sendSignup(entry)       called when the mailing-list form is sent (goes to the mailing service)
     sendSuggestion(entry)   called when the suggestion form is sent (goes to the site's own small store)
   The forms post to this site's own /api/ addresses, which answer "not connected" until they are set up.
   Picks in the game are not sent anywhere yet.
*/
(function () {
  'use strict';

  var root = document.documentElement.getAttribute('data-root') || '';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];

  /* ---- hooks ---- */
  // The three forms post to this site's own address and nowhere else. Until an endpoint is set up it answers
  // "not-connected", and the form says so.
  function post(path, entry) {
    return fetch('/api/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, reason: (r.status === 404 || r.status === 405 || r.status === 501) ? 'not-connected' : 'error' }; });
    }).catch(function () { return { ok: false, reason: 'error' }; });
  }
  function recordPick(pick) {
    // pick = { question: 'q37', other: 'gpt6-luna', otherCondition: 'instruction' | 'plain',
    //          picked: 'gpt4o' | 'other' | 'cannot-tell', preferred?: 'gpt4o' | 'other' | 'none' }
    // Not connected: picks are not counted yet. Later: return post('pick', pick)
    return Promise.resolve({ ok: false, reason: 'not-connected' });
  }
  function sendSignup(entry) { return post('signup', entry); }           // entry = { email, website }
  function sendSuggestion(entry) { return post('suggestion', entry); }   // entry = { text, email, website }
  function sendAsk(entry) { return post('ask', entry); }                 // entry = { text, email, website }

  /* ---- small helpers the other scripts share ---- */
  function usDate(iso) {            // 2026-12-11 -> December 11, 2026. The data's dates are already US Eastern.
    var p = String(iso).slice(0, 10).split('-');
    return MONTHS[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0];
  }
  function getJSON(path) {
    return fetch(root + 'data/' + path).then(function (r) {
      if (!r.ok) { throw new Error(path + ': ' + r.status); }
      return r.json();
    });
  }
  // Put text into a node, keeping names such as GPT-4o on one line.
  function setText(node, text) {
    node.textContent = '';
    var re = /GPT-\d[\w.]*(?: (?:Luna|Sol|Astra))?/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) { node.appendChild(document.createTextNode(text.slice(last, m.index))); }
      var name = document.createElement('span');
      name.className = 'nb';
      name.textContent = m[0];
      node.appendChild(name);
      last = m.index + m[0].length;
    }
    if (last < text.length) { node.appendChild(document.createTextNode(text.slice(last))); }
  }
  window.Fo4o = { root: root, usDate: usDate, getJSON: getJSON, setText: setText,
    recordPick: recordPick, sendSignup: sendSignup, sendSuggestion: sendSuggestion };

  /* ---- today, as a date in US Eastern time: every date on the site is US Eastern ---- */
  function easternToday() {
    var now = new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
        day: '2-digit' }).formatToParts(now);
      var got = {};
      for (var i = 0; i < parts.length; i++) { got[parts[i].type] = parts[i].value; }
      if (got.year && got.month && got.day) { return got.year + '-' + got.month + '-' + got.day; }
    } catch (e) { /* an old browser: fall back to the reader's own date */ }
    return now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  }
  var today = easternToday();

  /* ---- days left until a date. Worked out here, on the day the page is read, so the page never holds a
          number that goes stale. With scripts off the counts are simply not shown. ---- */
  function daysUntil(iso) {
    var a = today.split('-'), b = iso.split('-');
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  var counts = document.querySelectorAll('[data-days-until]');
  function drawCounts() {
    for (var n = 0; n < counts.length; n++) {
      var count = counts[n];
      var left = daysUntil(count.getAttribute('data-days-until'));
      var box = count.closest('[data-days-box]') || count;
      if (count.getAttribute('data-days-form') === 'number') {
        // a bare number; its "days left" label sits beside it in the page
        if (left < 0) { box.hidden = true; continue; }   // the date has passed: the box stays hidden
        count.textContent = String(left);
        var label = box.querySelector('[data-days-label]');
        if (label) { label.textContent = left === 1 ? 'day left' : 'days left'; }
      } else {
        count.textContent = left > 1 ? left + ' days left' : left === 1 ? '1 day left' : left === 0 ? 'Today'
          : 'This date has passed';
      }
      box.hidden = false;
      count.hidden = false;
    }
  }
  drawCounts();

  /* ---- menus: close an open one with Escape or a click outside ---- */
  var menus = document.querySelectorAll('details[data-menu]');
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') { return; }
    for (var m = 0; m < menus.length; m++) {
      if (menus[m].open) { menus[m].open = false; menus[m].querySelector('summary').focus(); }
    }
  });
  document.addEventListener('click', function (ev) {
    for (var m = 0; m < menus.length; m++) {
      if (menus[m].open && !menus[m].contains(ev.target)) { menus[m].open = false; }
    }
  });
  // tabbing out of an open menu closes it, so it does not stay open over the page
  Array.prototype.forEach.call(menus, function (menu) {
    menu.addEventListener('focusout', function (ev) {
      if (menu.open && ev.relatedTarget && !menu.contains(ev.relatedTarget)) { menu.open = false; }
    });
  });

  /* ---- the forms: mailing list, requests, questions for GPT-4o ---- */
  var forms = document.querySelectorAll('form[data-form]');
  for (var f = 0; f < forms.length; f++) { setUpForm(forms[f]); }

  var FORM_WORDS = {
    suggestion: { empty: 'Please write what you need first.', done: 'Thank you. Your request was sent.' },
    ask: { empty: 'Please write your question first.', done: 'Thank you. Your question was sent.' }
  };

  function setUpForm(formEl) {
    var kind = formEl.getAttribute('data-form');      // "signup", "suggestion" or "ask"
    var note = formEl.querySelector('[data-form-note]');
    var trap = formEl.querySelector('input[name="website"]');   // people never see this box; a filled one is a robot
    var button = formEl.querySelector('button[type="submit"]');
    var pending = false;                                         // one send at a time, so a double click sends once
    function say(text) { note.textContent = text; note.hidden = false; }
    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (pending) { return; }
      var email = formEl.querySelector('input[type="email"]');
      var website = trap ? trap.value : '';
      var sent, entry = null;
      if (kind === 'signup') {
        if (!email.value || !email.checkValidity()) {
          say('Please enter your email address.');
          email.focus();
          return;
        }
        sent = sendSignup({ email: email.value, website: website });
      } else {
        var box = formEl.querySelector('textarea');
        if (!box.value.trim()) {
          say(FORM_WORDS[kind].empty);
          box.focus();
          return;
        }
        if (email.value && !email.checkValidity()) {
          say('That email address does not look right. Fix it, or leave the box empty.');
          email.focus();
          return;
        }
        entry = { text: box.value.trim(), email: email.value.trim(), website: website };
        sent = kind === 'ask' ? sendAsk(entry) : sendSuggestion(entry);
      }
      pending = true;
      if (button) { button.disabled = true; }
      var settle = function () { pending = false; if (button) { button.disabled = false; } };
      sent.then(function (r) {
        if (r && r.ok) {
          say(kind === 'signup' ? (r.message || 'You are on the list.') : FORM_WORDS[kind].done);
          if (entry) {
            // clear only what was sent: anything typed since stays
            if (box.value.trim() === entry.text) { box.value = ''; }
            if (email.value.trim() === entry.email) { email.value = ''; }
            if (trap && trap.value === entry.website) { trap.value = ''; }
          }
        } else if (r && r.reason === 'not-connected') {
          say('This form is not connected yet, so nothing was sent or saved.');
        } else {
          say('Something went wrong, and nothing was sent. Please try again in a minute.');
        }
      }).then(settle, settle);
    });
  }

  /* ---- copy a block of text, word for word ---- */
  var copies = document.querySelectorAll('[data-copy]');
  for (var c = 0; c < copies.length; c++) { setUpCopy(copies[c]); }

  function setUpCopy(button) {
    var target = document.querySelector(button.getAttribute('data-copy'));
    var said = button.parentNode.querySelector('[data-copy-said]');
    if (!target || !navigator.clipboard || !navigator.clipboard.writeText) { return; }   // the text is on the page to select
    button.hidden = false;
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(target.textContent.trim()).then(function () {
        if (said) { said.textContent = 'Copied.'; }
      }, function () {
        if (said) { said.textContent = 'Could not copy. Select the text and copy it by hand.'; }
      });
    });
  }

  /* ---- timeline: mark the dates that are still ahead, as of the day the page is read ---- */
  var dated = document.querySelectorAll('[data-date]');
  function markAhead() {
    for (var d = 0; d < dated.length; d++) {
      var ahead = dated[d].getAttribute('data-date') > today;
      var line = dated[d].querySelector('.tl-date');
      var old = line ? line.querySelector('[data-ahead-tag]') : null;
      if (ahead) {
        dated[d].classList.add('is-ahead');
        if (line && !old) {
          var tag = document.createElement('span');
          tag.className = 'tag';
          tag.setAttribute('data-ahead-tag', '');
          tag.textContent = 'Still ahead';
          line.appendChild(tag);
        }
      } else {
        dated[d].classList.remove('is-ahead');
        if (old) { line.removeChild(old); }
      }
    }
  }
  markAhead();

  /* ---- a page left open past midnight, or brought back from the back/forward cache: work the days out again ---- */
  function refreshDays() {
    var now = easternToday();
    if (now === today) { return; }
    today = now;
    drawCounts();
    markAhead();
  }
  window.addEventListener('pageshow', refreshDays);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { refreshDays(); }
  });

  /* ---- reading pages: keep the question in view while its answer is being read (narrow screens) ---- */
  var bar = document.querySelector('[data-keep-bar]');
  var readings = document.querySelectorAll('[data-reading]');
  if (bar && readings.length) {
    var barText = bar.querySelector('[data-keep-text]');
    var waiting = false;
    var update = function () {
      waiting = false;
      var current = null;
      for (var r = 0; r < readings.length; r++) {
        var question = readings[r].querySelector('[data-question]');
        if (question.getBoundingClientRect().bottom < 0 && readings[r].getBoundingClientRect().bottom > 160) {
          current = question;
        }
      }
      if (current) {
        if (barText.textContent !== current.textContent) { barText.textContent = current.textContent; }
        bar.setAttribute('data-on', '');
      } else {
        bar.removeAttribute('data-on');
      }
    };
    window.addEventListener('scroll', function () {
      if (!waiting) { waiting = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }
})();
