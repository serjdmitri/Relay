// "Hey Jarvis": listening for a wake phrase while Relay is idle. It uses the same on-device speech helper as dictation,
// so nothing is recorded and nothing leaves the Mac. The words are read into text, compared with the phrase, and thrown away.

const { wakeAllowedIn } = require('./conversation');

const GREETINGS = new Set(['hey', 'hi', 'ok', 'okay', 'hay', 'a', 'hello']);

const activationMode=c=>['voice','claps-voice','claps'].includes(c.mode)?c.mode:c.requireClaps?'claps-voice':'voice';

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function distance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// Speech recognition mishears names, so a long word may be one letter off ("jarvus", "jervis").
const same = (heard, want) => heard === want || (want.length >= 5 && heard.length >= 4 && distance(heard, want) <= 1);

// A conservative two-impulse gate over the existing, on-device microphone level.
// Levels are sampled about 20 times per second, so a real microphone check is needed.
class ClapGate {
  constructor() { this.reset(); }
  reset() { this.high = false; this.highSince=null; this.first = null; this.until = 0; this.floor = .025; }
  level(value, now, minimum=.18) {
    const sample = Number(value);
    if (!Number.isFinite(sample)) return false;
    const threshold = Math.max(Math.max(.05,Math.min(.7,Number(minimum)||.18)), Math.min(.9, this.floor * 4 + .07));
    if (sample < threshold * .8) {
      let pair=false;
      if(this.high){
        const at=this.highSince,duration=now-at;
        if(duration<=180){if(this.first!==null&&at-this.first>=120&&at-this.first<=900){this.until=now+5000;this.first=null;pair=true;}else this.first=at;}
        else this.first=null;
      }
      this.high=false;this.highSince=null;this.floor=this.floor*.94+Math.max(0,sample)*.06;return pair;
    }
    if(sample<threshold||this.high)return false;
    this.high=true;this.highSince=now;
    return false;
  }
  ready(now) { return this.until > 0 && now <= this.until; }
}

// Does the text end with (or contain, near its end) the wake phrase? "Hey Jarvis" also matches "okay jarvis" and "hi jarvis".
function heardWake(text, phrase) {
  const heard = clean(text).split(' ').filter(Boolean).slice(-12);
  const want = clean(phrase).split(' ').filter(Boolean);
  if (!want.length || !heard.length) return false;
  // The default Jarvis phrase also accepts the explicit "Jarvis, wake up".
  // Custom phrases are left alone, and the complete wake-up wording is required.
  if (want.join(' ') === 'hey jarvis') {
    for (let i = 0; i + 2 < heard.length; i++) {
      if (same(heard[i], 'jarvis') && heard[i + 1] === 'wake' && heard[i + 2] === 'up') return true;
    }
  }
  const greeting = GREETINGS.has(want[0]);
  const name = greeting ? want.slice(1) : want;
  if (!name.length) return false;
  for (let i = 0; i + name.length <= heard.length; i++) {
    if (!name.every((w, k) => same(heard[i + k], w))) continue;
    if (!greeting) return true;
    const before = heard[i - 1];
    if (before && GREETINGS.has(before)) return true;
  }
  return false;
}

class WakeWord {
  // speech: the Speech wrapper (events 'partial', and listen()/cancel()).
  // getConfig(): { enabled, phrase }. canListen(): false while Relay is busy, speaking or being configured.
  constructor({ speech, getConfig, canListen, getFront = () => null, onWake, onArmed = () => {}, getDevice = () => 'auto', log = console, restartMs = 90000, setTimer = setTimeout, clearTimer = clearTimeout, handoffMs = 280 }) {
    this.speech = speech;
    this.getConfig = getConfig;
    this.canListen = canListen;
    this.getFront = getFront; // the app in front (only asked when the wake phrase is limited to some apps)
    this.onWake = onWake;
    this.onArmed = onArmed;
    this.getDevice = getDevice;
    this.log = log;
    this.restartMs = restartMs; this.handoffMs = handoffMs; this.handoff = null; this.pendingText = null;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.armed = false;
    this.arming = false;
    this.timer = null;
    this.retry = null;
    this.errors = 0;
    this.lastWake = 0;
    this.claps = new ClapGate();
    this.lastPartial = '';
    this.clapPrefix = '';
    this.onPartial = (text) => this.partial(text);
    speech.on('partial', this.onPartial);
    const clap=(level)=>{const c=this.getConfig();if(!this.armed||activationMode(c)==='voice'||!this.claps.level(level,Date.now(),c.clapThreshold))return;this.clapPrefix=clean(this.lastPartial);if(activationMode(c)==='claps'&&this.wanted&&Date.now()-this.lastWake>=1500){this.lastWake=Date.now();this.disarm();this.onWake('');}};
    speech.on('acoustic',sample=>{this.acousticAt=Date.now();const peak=Number(sample?.peak),rms=Number(sample?.rms);if(Number.isFinite(peak)&&Number.isFinite(rms))clap(peak>rms*2.5?Math.min(1,peak*3):0);});
    speech.on('level',level=>{if(!this.acousticAt||Date.now()-this.acousticAt>1000)clap(level);});
    const ended=()=>{
      if(!this.armed)return;
      this.disarm();
      this.retry=this.setTimer(()=>this.refresh(),500);
    };
    for(const event of ['error-event','error','exit'])speech.on(event,ended);
    speech.on('final',msg=>{
      if(!this.armed)return;
      // A final transcript ends recognition: deliver a valid pending wake now,
      // rather than cancelling its handoff timer and losing the command.
      if(typeof msg?.text==='string'&&msg.text.trim()){this.pendingText=null;this.partial(msg.text);}
      if(this.armed&&this.pendingText&&this.wanted){const text=this.pendingText;this.lastWake=Date.now();this.disarm();this.onWake(text);}
      else ended();
    });
  }

  get wanted() {
    const c = this.getConfig();
    return !!c.enabled && (activationMode(c)==='claps'||!!c.phrase) && !!this.canListen() && wakeAllowedIn(c.apps, c.apps && c.apps.length ? this.getFront() : null);
  }

  // Start or stop listening to match what should be happening right now. Safe to call as often as you like.
  async refresh() {
    if (this.wanted) await this.arm();
    else this.disarm();
  }

  async arm() {
    if (this.armed || this.arming) return;
    this.arming = true;
    try {
      await this.speech.listen(this.getDevice());
      if (!this.wanted) { this.speech.cancel(); return; } // things changed while the microphone opened
      this.armed = true;
      this.errors = 0;
      this.onArmed(true);
      this.clearTimer(this.timer);
      this.timer = this.setTimer(() => this.cycle(), this.restartMs); // a fresh session now and then keeps the recogniser light
    } catch (e) {
      this.log.error?.('wake word:', e.message);
      this.errors++;
      this.onArmed(false);
      if (this.wanted) { // recover after a transient device or recognizer failure, with bounded backoff
        this.clearTimer(this.retry);
        this.retry = this.setTimer(() => this.refresh(), Math.min(30000,2000 * this.errors));
      }
    } finally {
      this.arming = false;
    }
  }

  cycle() {
    this.disarm();
    this.setTimer(() => this.refresh(), 400);
  }

  disarm() {
    this.clearTimer(this.timer);
    this.clearTimer(this.retry);
    this.clearTimer(this.handoff); this.handoff = null; this.pendingText = null;
    if (!this.armed) return;
    this.armed = false;
    this.claps.reset();
    this.lastPartial = '';
    this.clapPrefix = '';
    try { this.speech.cancel(); } catch {}
    this.onArmed(false);
  }

  partial(text) {
    if (!this.armed) return;
    const c = this.getConfig();
    this.lastPartial = text;
    if(activationMode(c)==='claps')return;
    let candidate = text;
    if (activationMode(c)==='claps-voice') {
      if (!this.claps.ready(Date.now())) return;
      const current = clean(text);
      if (this.clapPrefix && current.startsWith(`${this.clapPrefix} `)) candidate = current.slice(this.clapPrefix.length).trim();
      else if (this.clapPrefix && heardWake(this.clapPrefix, c.phrase)) return;
      else candidate = current; // recognition can revise earlier background words after the claps
    }
    if (!heardWake(candidate, c.phrase)) return;
    if (Date.now() - this.lastWake < 1500) return;
    this.pendingText = candidate;
    this.clearTimer(this.handoff);
    const revision=this.handoffRevision=(this.handoffRevision||0)+1;
    const fire = () => {
      if (!this.armed || !this.wanted || revision!==this.handoffRevision) return;
      const heard = this.pendingText;
      this.lastWake = Date.now(); this.disarm(); this.onWake(heard);
    };
    if (!this.handoffMs) fire(); else this.handoff = this.setTimer(fire, this.handoffMs);
  }
}

function commandAfterWake(text, phrase) {
  const heard = clean(text).split(' ').filter(Boolean), want = clean(phrase).split(' ').filter(Boolean);
  const name = GREETINGS.has(want[0]) ? want.slice(1) : want;
  for (let i = heard.length - 1; i >= 0; i--) {
    if (want.join(' ') === 'hey jarvis' && same(heard[i], 'jarvis') && heard[i+1] === 'wake' && heard[i+2] === 'up') return heard.slice(i+3).join(' ');
    if (name.length && name.every((w,k) => heard[i+k] && same(heard[i+k], w)) && (!GREETINGS.has(want[0]) || GREETINGS.has(heard[i-1]))) return heard.slice(i+name.length).join(' ');
  }
  return '';
}
module.exports = { activationMode, WakeWord, ClapGate, heardWake, clean, commandAfterWake };
