// The phone page's look, set before the page paints so it never flashes the old colours. The Mac decides (Settings > Appearance) and sends it with its state; the last one is
// remembered here. <html data-look="glass|instrument|studio|cockpit|buddy">, and data-mode="dark|light" only when the Mac forces one (otherwise the iPhone's own setting decides).
(function () {
  var LOOKS = ['glass', 'instrument', 'studio', 'cockpit', 'buddy'];
  function apply(look, mode) {
    var root = document.documentElement;
    if (LOOKS.indexOf(look) < 0) look = 'glass';
    root.setAttribute('data-look', look);
    if (mode === 'dark' || mode === 'light') root.setAttribute('data-mode', mode); else root.removeAttribute('data-mode');
    var light = mode === 'light' || (mode !== 'dark' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#eef6fa' : '#050d14');
    try { localStorage.setItem('relay-look', look); localStorage.setItem('relay-mode', mode || 'system'); } catch (e) { /* private mode: it still applies for this visit */ }
  }
  var look = null, mode = null;
  try { look = localStorage.getItem('relay-look'); mode = localStorage.getItem('relay-mode'); } catch (e) { /* no storage */ }
  apply(look, mode);
  window.RelayLook = { apply: apply, looks: LOOKS };
})();
