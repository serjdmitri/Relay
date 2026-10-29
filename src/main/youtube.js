// YouTube by voice: "pause YouTube", "skip ahead 30 seconds on YouTube", "YouTube speed 1.5", "next video". No model call and no tokens.
// Relay finds the YouTube tab in Chrome, Brave, Edge, Arc or Safari and runs a tiny script in that page through AppleScript, so it works while you
// are in another app and never types into the wrong field. The browser must allow it once: Chrome-family View > Developer > Allow JavaScript
// from Apple Events; Safari Develop > Developer Settings > Allow JavaScript from Apple Events.

const CHROMIUM = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Arc'];
const WATCH = ['youtube.com/watch', 'youtube.com/shorts', 'music.youtube.com', 'youtube.com/live'];

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.: ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '');
const secs = (n, unit) => Math.round(Number(n) * (/^m/.test(unit || '') ? 60 : 1));
const AMOUNT = '(\\d+(?:\\.\\d+)?)\\s*(seconds?|secs?|s|minutes?|mins?|m)?';

// -> { type: 'youtube', op, ... } or null. Needs the word "youtube" (or "the video") so plain "pause" still goes to your music app.
function parseRaw(text) {
  let n = clean(text);
  const named = /\byoutube\b/.test(n);
  const video = /\b(?:this|the|current) video\b/.test(n);
  if (!named && !video) return null;
  n = n.replace(/\b(?:on|in|for|of|from) youtube\b/g, ' ').replace(/\byoutube\b/g, ' ').replace(/\b(?:this|the|current) video\b/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if (/^(?:pause|stop|hold)$/.test(n)) return { type: 'youtube', op: 'pause' };
  if (/^(?:play|resume|unpause|continue|start)$/.test(n)) return { type: 'youtube', op: 'play' };
  if (/^(?:play pause|toggle|toggle playback)$/.test(n)) return { type: 'youtube', op: 'toggle' };
  if (/^(?:next|next video|skip|play next|skip this)$/.test(n)) return { type: 'youtube', op: 'next' };
  if (/^(?:previous|previous video|last video|go back a video)$/.test(n)) return { type: 'youtube', op: 'previous' };
  if (/^(?:mute|silence)$/.test(n)) return { type: 'youtube', op: 'mute', on: true };
  if (/^(?:unmute)$/.test(n)) return { type: 'youtube', op: 'mute', on: false };
  if (/^(?:full ?screen|go full ?screen|make it full ?screen)$/.test(n)) return { type: 'youtube', op: 'fullscreen' };
  if (/^(?:captions?|subtitles?|turn on captions?|turn on subtitles?|toggle captions?|toggle subtitles?)$/.test(n)) return { type: 'youtube', op: 'captions' };
  if (/^(?:restart|start over|from the beginning|go to the start)$/.test(n)) return { type: 'youtube', op: 'seek-to', to: 0 };
  if ((m = n.match(new RegExp(`^(?:skip|jump|go|fast forward|forward|seek)(?: ahead| forward)?(?: by)? ${AMOUNT}(?: ahead| forward)?$`)))) return { type: 'youtube', op: 'seek', by: secs(m[1], m[2]) };
  if ((m = n.match(new RegExp(`^(?:rewind|go back|back|skip back|jump back|seek back)(?: by)? ${AMOUNT}(?: back)?$`)))) return { type: 'youtube', op: 'seek', by: -secs(m[1], m[2]) };
  if ((m = n.match(/^(?:rewind|go back|back)$/))) return { type: 'youtube', op: 'seek', by: -10 };
  if ((m = n.match(new RegExp(`^(?:go to|jump to|seek to|skip to|start at) ${AMOUNT}$`)))) return { type: 'youtube', op: 'seek-to', to: secs(m[1], m[2] || 'm') };
  if ((m = n.match(/^(?:go to|jump to|seek to|skip to) (\d+):(\d\d)$/))) return { type: 'youtube', op: 'seek-to', to: Number(m[1]) * 60 + Number(m[2]) };
  if ((m = n.match(/^(?:speed|set speed|playback speed|speed up to|set speed to|speed to|play at)\s*(\d+(?:\.\d+)?)\s*x?$/))) return { type: 'youtube', op: 'speed', rate: Number(m[1]) };
  if (/^(?:speed up|faster|play faster)$/.test(n)) return { type: 'youtube', op: 'speed-step', step: 0.25 };
  if (/^(?:slow down|slower|play slower)$/.test(n)) return { type: 'youtube', op: 'speed-step', step: -0.25 };
  if ((m = n.match(/^(?:volume|set volume to|volume to) (\d+)(?: percent)?$/))) return { type: 'youtube', op: 'volume', to: Math.min(100, Number(m[1])) };
  if (/^(?:louder|volume up|turn it up)$/.test(n)) return { type: 'youtube', op: 'volume-step', step: 10 };
  if (/^(?:quieter|volume down|turn it down)$/.test(n)) return { type: 'youtube', op: 'volume-step', step: -10 };
  if (/^(?:what s playing|what is playing|what is this|what video is this|title|what am i watching)$/.test(n)) return { type: 'youtube', op: 'info' };
  return null;
}

function parseYoutubeCommand(text) {
  const cmd = parseRaw(text);
  // "the video" alone could be any player: if there is no YouTube tab the command is left for the others
  return cmd ? { ...cmd, weak: !/\byoutube\b/i.test(String(text)) } : null;
}

// The page script for one command. It always ends by returning a short status ("title|paused|time|duration") that becomes the spoken reply.
function pageScript(cmd) {
  const body = {
    pause: 'v.pause();',
    play: 'v.play();',
    toggle: 'v.paused ? v.play() : v.pause();',
    next: "var b=document.querySelector('.ytp-next-button'); if(b){b.click();}else{return 'NONEXT';}",
    previous: 'history.back();',
    mute: `v.muted = ${cmd.on ? 'true' : 'false'};`,
    fullscreen: "var f=document.querySelector('.ytp-fullscreen-button'); if(f){f.click();}",
    captions: "var c=document.querySelector('.ytp-subtitles-button'); if(c){c.click();}else{return 'NOCAPTIONS';}",
    seek: `v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + (${Number(cmd.by) || 0})));`,
    'seek-to': `v.currentTime = Math.max(0, Math.min(v.duration || 1e9, ${Number(cmd.to) || 0}));`,
    speed: `v.playbackRate = Math.max(0.25, Math.min(2, ${Number(cmd.rate) || 1}));`,
    'speed-step': `v.playbackRate = Math.max(0.25, Math.min(2, Math.round((v.playbackRate + (${Number(cmd.step) || 0})) * 100) / 100));`,
    volume: `v.muted = false; v.volume = ${Math.max(0, Math.min(100, Number(cmd.to) || 0)) / 100};`,
    'volume-step': `v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + (${(Number(cmd.step) || 0) / 100})));`,
    info: ''
  }[cmd.op];
  if (body === undefined) throw new Error(`Unknown YouTube command ${cmd.op}`);
  return `(function(){var v=document.querySelector('video'); if(!v){return 'NOVIDEO';} ${body} return [document.title.replace(/ - YouTube$/,''), v.paused?'paused':'playing', Math.round(v.currentTime), Math.round(v.duration||0), v.playbackRate, v.muted?'muted':'sound', Math.round(v.volume*100)].join('|');})()`;
}

const asString = (js) => `"${String(js).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const matchTest = (prop) => WATCH.map((u) => `${prop} contains "${u}"`).join(' or ');

// The AppleScript that finds the first YouTube tab in a browser and runs the page script there. NOTAB when none; NOBROWSER when it is not running.
function tabScript(browser, js) {
  const guard = `if application "${browser}" is not running then return "NOBROWSER"`;
  if (browser === 'Safari') {
    return [guard, 'tell application "Safari"', 'repeat with w in windows', 'repeat with t in tabs of w', `if ${matchTest('URL of t')} then`, `return do JavaScript ${asString(js)} in t`, 'end if', 'end repeat', 'end repeat', 'end tell', 'return "NOTAB"'];
  }
  return [guard, `tell application "${browser}"`, 'repeat with w in windows', 'repeat with t in tabs of w', `if ${matchTest('URL of t')} then`, `return execute t javascript ${asString(js)}`, 'end if', 'end repeat', 'end repeat', 'end tell', 'return "NOTAB"'];
}

const mmss = (s) => { const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

// The spoken answer for what the page returned.
function replyFor(cmd, out) {
  const raw = String(out || '').trim();
  if (raw === 'NOVIDEO') return 'That YouTube tab has no video playing on it.';
  if (raw === 'NONEXT') return 'There is no next video here.';
  if (raw === 'NOCAPTIONS') return 'This video has no captions button.';
  const [title, state, t, d, rate, snd, vol] = raw.split('|');
  const at = `${mmss(Number(t) || 0)}${Number(d) ? ` of ${mmss(Number(d))}` : ''}`;
  switch (cmd.op) {
    case 'pause': return 'Paused.';
    case 'play': return 'Playing.';
    case 'toggle': return state === 'paused' ? 'Paused.' : 'Playing.';
    case 'next': return 'Next video.';
    case 'previous': return 'Going back.';
    case 'mute': return cmd.on ? 'Muted.' : 'Sound on.';
    case 'fullscreen': return 'Toggled full screen.';
    case 'captions': return 'Toggled captions.';
    case 'seek': return `${cmd.by >= 0 ? 'Skipped ahead' : 'Went back'} ${Math.abs(cmd.by)} seconds. Now at ${at}.`;
    case 'seek-to': return `Jumped to ${at}.`;
    case 'speed': case 'speed-step': return `Speed ${Number(rate)}x.`;
    case 'volume': case 'volume-step': return `Volume ${vol} percent.`;
    case 'info': return `${title || 'A YouTube video'}, ${state}, at ${at}.`;
    default: return 'Done.';
  }
}

const SETUP = 'To control YouTube, turn on "Allow JavaScript from Apple Events" once: in Chrome, Brave, Edge or Arc it is under View > Developer; in Safari, Develop > Developer Settings.';

class YoutubeControl {
  // osa(lines): runs AppleScript lines and returns the text. browsers: the order to look in.
  constructor({ osa, browsers = [...CHROMIUM, 'Safari'] } = {}) { Object.assign(this, { osa, browsers }); }

  async run(cmd) {
    const js = pageScript(cmd);
    let setupNeeded = false;
    for (const b of this.browsers) {
      let out;
      try { out = String(await this.osa(tabScript(b, js))).trim(); } catch (e) {
        if (/javascript from apple events|not allowed|AppleScript is turned off|-1743|8:|-1728/i.test(String(e.message)) && /javascript|apple events/i.test(String(e.message))) setupNeeded = true;
        continue;
      }
      if (out === 'NOBROWSER' || out === 'NOTAB') continue;
      return { reply: replyFor(cmd, out), browser: b };
    }
    return { reply: setupNeeded ? SETUP : 'I could not find an open YouTube video in Chrome, Brave, Edge, Arc or Safari. For Firefox, tell me what to do in words and I will use the browser tools.', failed: true, miss: !setupNeeded };
  }
}

module.exports = { parseYoutubeCommand, pageScript, tabScript, replyFor, YoutubeControl, SETUP, CHROMIUM };
