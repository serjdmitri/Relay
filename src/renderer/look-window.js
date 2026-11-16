// The look for the small floating windows (answer card, assist, holograms, agents and the like). The main window saves the chosen look in localStorage (all of Relay's pages share it)
// and this sets <html data-look="..."> from it, so jarvis-surface.css can restyle the window, and keeps it current when the look changes while the window is open.
(function () {
  var LOOKS = ['glass', 'instrument', 'studio', 'cockpit', 'buddy'];
  function apply() {
    var look = null;
    try { look = localStorage.getItem('relay-look'); } catch (e) { /* no storage: the default */ }
    document.documentElement.setAttribute('data-look', LOOKS.indexOf(look) < 0 ? 'glass' : look);
  }
  apply();
  window.addEventListener('storage', function (e) { if (e.key === 'relay-look') apply(); });
})();
