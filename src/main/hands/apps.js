// What a hand sign does depends on the app in front. A swipe of the open hand: in a web browser it goes to the next or previous tab, in Music or
// Spotify to the next or previous track, in a slide show to the next or previous slide; anywhere else it does nothing. Pure: it only says what to do,
// main.js does it. Also the voice command that gives a sign a job of your own ("when I show the rock sign, play my focus playlist").
const { BROWSER_IDS } = require('./externalDrag');

const MUSIC = { 'com.apple.Music': 'Music', 'com.spotify.client': 'Spotify' };
const SLIDES = new Set(['com.apple.iWork.Keynote', 'com.microsoft.Powerpoint']);

const appKind = (id) => (BROWSER_IDS.has(id) ? 'browser' : MUSIC[id] ? 'music' : SLIDES.has(id) ? 'slides' : null);

// dir: 'right' (next) or 'left' (previous). -> null, or what to do.
function swipeAction(id, dir) {
  const next = dir === 'right';
  switch (appKind(id)) {
    case 'browser': return { kind: 'tab', next };
    case 'music': return { kind: 'track', app: MUSIC[id], next };
    case 'slides': return { kind: 'slide', next };
    default: return null;
  }
}

// The AppleScript lines for an action (System Events key presses, or the music app's own commands, only if the app is already running).
function scriptFor(a) {
  if (!a) return null;
  if (a.kind === 'tab') return ['tell application "System Events" to key code 48 using ' + (a.next ? 'control down' : '{control down, shift down}')];
  if (a.kind === 'slide') return [`tell application "System Events" to key code ${a.next ? 124 : 123}`];
  if (a.kind === 'track' && /^(Music|Spotify)$/.test(a.app)) return [`if application "${a.app}" is running then tell application "${a.app}" to ${a.next ? 'next track' : 'previous track'}`];
  return null;
}

const SIGNS = { rock: 'rock', wave: 'wave', stop: 'stop', peace: 'peace' };
// "when I show the rock sign, play my focus playlist" / "make the wave sign open my email" / "what do my hand signs do" / "reset my hand signs"
function parseSignCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (/^(?:what do my hand (?:signs|gestures) do|list my hand (?:signs|gestures))$/i.test(n)) return { type: 'sign-list' };
  if (/^(?:reset|clear) (?:my )?hand (?:signs|gestures)$/i.test(n)) return { type: 'sign-reset' };
  let m = /^(?:when|whenever|if) i (?:show|make|do|hold up) (?:the |a )?(rock|wave|stop|palm)(?: sign| gesture)?,? (?:then )?(.{3,200})$/i.exec(n)
    || /^(?:make|set) (?:the |my )?(rock|wave|stop|palm)(?: sign| gesture) (?:to )?(.{3,200})$/i.exec(n);
  if (m) { const sign = m[1].toLowerCase() === 'palm' ? 'stop' : m[1].toLowerCase(); return SIGNS[sign] ? { type: 'sign-set', sign, command: m[2].trim() } : null; }
  return null;
}

module.exports = { appKind, swipeAction, scriptFor, parseSignCommand, MUSIC };
