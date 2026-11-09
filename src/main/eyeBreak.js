// Eye breaks (the 20-20-20 habit): after about 20 minutes of real work at the Mac, the screens blur and Relay asks you to look at something far away
// for 20 seconds. Opt-in. Time only counts while you are active (the Mac's own idle time), so lunch or a call away from the keyboard counts as a break and
// the clock starts again. Nothing is recorded. This file is the scheduler and the words; the blur window is drawn by main.js. The clock is injected.

const TICK_MS = 30000;

class EyeBreaks {
  // cfg(): { enabled, everyMin, seconds }; idleSeconds(): seconds since the last key or mouse movement; busy(): in a meeting or talking; start(seconds): show the break
  constructor({ cfg, idleSeconds, busy = () => false, start, now = Date.now }) { Object.assign(this, { cfg, idleSeconds, busy, start, now }); this.reset(); }

  reset() { this.active = 0; this.last = this.now(); this.snoozeUntil = 0; this.nextAt = 0; }

  // Called every TICK_MS. -> true when a break was started.
  tick() {
    const t = this.now(), c = this.cfg() || {};
    const dt = Math.max(0, Math.min(t - this.last, 2 * TICK_MS)); this.last = t;
    if (!c.enabled) { this.active = 0; return false; }
    if (this.idleSeconds() >= 120) { this.active = 0; return false; } // away from the keyboard: that is a break already
    if (t < this.snoozeUntil || this.busy()) return false;
    this.active += dt;
    if (this.active < Math.max(1, Number(c.everyMin) || 20) * 60000) return false;
    this.active = 0;
    this.start(Math.max(5, Math.min(120, Number(c.seconds) || 20)));
    return true;
  }

  snooze(minutes = 10) { this.snoozeUntil = this.now() + minutes * 60000; }
  // Minutes until the next break (for "when is my next eye break"), or null when off.
  minutesLeft() { const c = this.cfg() || {}; return c.enabled ? Math.max(0, Math.round(((Number(c.everyMin) || 20) * 60000 - this.active) / 60000)) : null; }
}

// The words: "turn on eye breaks", "turn off eye breaks", "take an eye break", "snooze the eye break", "when is my next eye break".
function parseEyeCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:turn on|enable|start|switch on|remind me to take|give me) (?:the )?eye breaks?$|^remind me to rest my eyes$/.test(n)) return { type: 'eye-on' };
  if (/^(?:turn off|disable|stop|switch off) (?:the )?eye breaks?$/.test(n)) return { type: 'eye-off' };
  if (/^(?:take|start|do|give me) (?:an? )?(?:eye|screen) break(?: now)?$|^rest my eyes(?: now)?$|^blur (?:my|the) screens?$/.test(n)) return { type: 'eye-now' };
  if (/^(?:snooze|skip|delay|postpone) (?:the |my |this )?(?:next )?eye break$/.test(n)) return { type: 'eye-snooze' };
  if (/^when(?:'s| is) my next eye break$|^eye break status$/.test(n)) return { type: 'eye-status' };
  return null;
}

// What the blur screen shows (plain HTML, nothing from outside). seconds counts down; the button ends the break early.
function breakHtml(seconds) {
  const s = Math.max(5, Math.min(120, Math.round(Number(seconds) || 20)));
  return `<body style="margin:0;height:100vh;display:grid;place-items:center;background:rgba(10,16,24,.18);color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;text-align:center;-webkit-user-select:none;overflow:hidden">
<div><div style="font-size:22px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">Eye break</div>
<div style="font-size:46px;font-weight:600;margin:14px 0 6px">Look at something far away</div>
<div style="font-size:19px;opacity:.85">About 20 feet (6 metres), and blink slowly.</div>
<div id="n" style="font-size:96px;font-weight:200;margin:22px 0 8px;font-variant-numeric:tabular-nums">${s}</div>
<a href="relay-skip://now" style="display:inline-block;padding:9px 22px;border-radius:999px;border:1px solid rgba(255,255,255,.55);color:#fff;text-decoration:none;font-size:15px;background:rgba(255,255,255,.1)">Skip</a></div>
<script>let n=${s};const el=document.getElementById('n');setInterval(()=>{n=Math.max(0,n-1);el.textContent=n;if(n===0)location.href='relay-skip://done'},1000)</script></body>`;
}

module.exports = { EyeBreaks, parseEyeCommand, breakHtml, TICK_MS };
