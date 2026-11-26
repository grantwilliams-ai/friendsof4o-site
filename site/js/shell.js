/* Friends of 4o: the "Sunset Panels" shell. On every page that wears the shell.
   One small thing: arriving at #more opens the More list in the top bar and puts the keyboard on it. The click
   part is for a footer link marked data-open-more, which only today's design with the vote's pages has (there the
   footer's "More on this site" opens the list in place); in the new design that link goes to the /more/ page and
   no click is caught. Without this script the link still jumps to the More button. Nothing is stored. */
(function () {
  'use strict';
  var more = document.getElementById('more');
  if (!more) { return; }
  function open() {
    more.open = true;
    more.scrollIntoView({ block: 'start' });
    var s = more.querySelector('summary');
    if (s) { s.focus({ preventScroll: true }); }
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest ? ev.target.closest('a[data-open-more]') : null;
    if (!a) { return; }
    ev.preventDefault();
    ev.stopPropagation();          // the shared menu script closes a menu on a click outside it
    open();
  }, true);
  if (window.location.hash === '#more') { open(); }
})();
