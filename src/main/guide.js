const { guideCommand, inRect } = require('./overlayGeometry');

// A step-by-step guide that moves on by itself. The model hands over the whole list once, each step with the element to
// click when it knows it. Relay then points at the current step and goes to the next one when the user clicks the
// highlighted spot or says "next", so the model is not asked again for every step.
const CLICK_MARGIN = 10; // points around the highlighted element that still count as clicking it
const SPOT_R = 30; // the ring drawn around a spot that has no element
const AFTER_CLICK_MS = 450; // let the app react before the next step is looked up
const RETRY_MS = 400;
const NEXT_TRIES = 6; // a later step's element may take a moment to appear
const POLL_MS = 1500; // how often the highlighted element is checked while a guide is up
const MISSES = 3; // polls in a row that must miss before the element counts as gone
const MOVED = 6; // points the element must move before the outline follows it
const OFFTRACK_MS = 1500; // a click elsewhere is checked after the screen settles
const REPLAN_GAP_MS = 8000; // at most one progress check this often
const MAX_REPLANS = 6;

class Guide {
  // onReplan({ goal, steps, index, reason }): asks the model to look at the screen and fix the plan. Set by the app.
  constructor({ overlay, mac, getCursor = () => ({ x: 0, y: 0 }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onReplan = null, now = () => Date.now() }) {
    this.overlay = overlay;
    this.mac = mac;
    this.getCursor = getCursor;
    this.sleep = sleep;
    this.steps = [];
    this.index = 0;
    this.live = false;
    this.region = null; // where a click counts as doing the current step
    this.timer = null;
    this.busy = false;
    this.onReplan = onReplan;
    this.now = now;
    this.goal = '';
    this.replans = 0;
    this.lastReplan = -Infinity;
    this.replanTimer = null;
    this.poll = null;
    this.polling = false;
    this.misses = 0;
  }

  get active() {
    return this.live;
  }

  command(text) {
    return this.live ? guideCommand(text) : null;
  }

  // steps: [{ text, app?, name?, pt? }]. Returns a sentence for the model.
  async start(steps, current = 0, goal = '') {
    this.steps = steps;
    this.goal = goal || steps[steps.length - 1].text;
    this.live = true;
    const r = await this.show(current, 1);
    if (r === false) {
      this.live = false;
      return false;
    }
    const last = this.steps.length;
    return `Guide shown, step ${this.index + 1} of ${last}. Relay moves to the next step when the user clicks the highlighted spot or says "next", so do not call guide_step again. Tell the user in one short sentence what to do first.${r.note ? ` ${r.note}` : ''}`;
  }

  async locate(step, tries) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        // Look in the accessibility tree each time; read the screen's text only on the last try (it is slower).
        if (this.mac.locate) return await this.mac.locate(step.app, step.name, { seconds: tries > 1 ? 1.2 : 2.5, ocr: i === tries - 1 });
        return await this.mac.uiLocate(step.app, step.name);
      } catch (e) {
        last = e;
        if (i < tries - 1) await this.sleep(RETRY_MS);
      }
    }
    throw last;
  }

  async show(i, tries = 1) {
    this.index = Math.max(0, Math.min(this.steps.length - 1, i));
    const step = this.steps[this.index];
    const card = { steps: this.steps.map((s) => s.text), current: this.index, total: this.steps.length };
    let target = null;
    let shape = null;
    let note = '';
    this.region = null;
    if (step.app && step.name) {
      try {
        const f = await this.locate(step, tries);
        target = { x: f.cx, y: f.cy };
        shape = { type: 'box', x: f.x, y: f.y, w: f.w, h: f.h, label: '' };
        this.region = { x: f.x, y: f.y, w: f.w, h: f.h };
      } catch (e) {
        note = `Could not find "${step.name}" in ${step.app}, so step ${this.index + 1} has no highlight (${e.message})`;
      }
    } else if (step.pt) {
      target = { x: step.pt.x, y: step.pt.y };
      shape = { type: 'circle', x: step.pt.x, y: step.pt.y, r: SPOT_R, label: '' };
      this.region = { x: step.pt.x - SPOT_R, y: step.pt.y - SPOT_R, w: SPOT_R * 2, h: SPOT_R * 2 };
    }
    const shown = await this.overlay.guide(card, target, shape);
    if (shown === false) return false;
    this.misses = 0;
    this.watch();
    return { note, found: !!this.region || !(step.app && step.name) };
  }

  async next() {
    if (!this.live) return 'There is no guide to continue.';
    if (this.index + 1 >= this.steps.length) {
      this.stop();
      return 'That was the last step.';
    }
    const r = await this.show(this.index + 1, NEXT_TRIES);
    if (r === false) return 'Guides are turned off.';
    const text = `Step ${this.index + 1} of ${this.steps.length}: ${this.steps[this.index].text}`;
    if (r.note) {
      this.requestReplan(`Step ${this.index + 1} ("${this.steps[this.index].text}") has nothing to point at: its element could not be found on screen.`);
      return `${text}. Checking the screen.`;
    }
    return text;
  }

  async back() {
    if (!this.live) return 'There is no guide to go back in.';
    if (this.index === 0) return 'You are on the first step.';
    await this.show(this.index - 1, NEXT_TRIES);
    return `Back to step ${this.index + 1}: ${this.steps[this.index].text}`;
  }

  // A spoken or typed "next", "back" or "stop". Returns the reply for the pill.
  async run(cmd) {
    if (cmd === 'stop') {
      this.stop();
      return 'Closed the guide.';
    }
    if (this.busy) return 'One moment.';
    this.busy = true;
    try {
      return cmd === 'back' ? await this.back() : await this.next();
    } finally {
      this.busy = false;
    }
  }

  // Called on every mouse button release anywhere. A click on the highlighted spot is the step done; a click anywhere
  // else means the user may have gone another way, so the screen is checked once it settles.
  onClick() {
    if (!this.live || this.busy) return;
    if (this.region && inRect(this.getCursor(), this.region, CLICK_MARGIN)) {
      clearTimeout(this.replanTimer);
      clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        if (!this.live || this.busy) return;
        this.busy = true;
        try {
          await this.next();
        } finally {
          this.busy = false;
        }
      }, AFTER_CLICK_MS);
      return;
    }
    clearTimeout(this.replanTimer);
    this.replanTimer = setTimeout(() => this.requestReplan('They clicked somewhere other than the highlighted spot.'), OFFTRACK_MS);
  }

  // Keeps the outline on its element while the user moves or scrolls the window, and notices when it disappears.
  watch() {
    if (this.poll) return;
    this.poll = setInterval(() => this.check(), POLL_MS);
    if (this.poll.unref) this.poll.unref();
  }

  async check() {
    const step = this.steps[this.index];
    if (!this.live || this.busy || this.polling || !step || !step.app || !step.name || !this.region) return;
    this.polling = true;
    try {
      const f = await this.mac.uiLocate(step.app, step.name, { seconds: 0.8 });
      if (!this.live) return;
      this.misses = 0;
      const r = this.region;
      if (Math.abs(f.x - r.x) > MOVED || Math.abs(f.y - r.y) > MOVED || Math.abs(f.w - r.w) > MOVED || Math.abs(f.h - r.h) > MOVED) {
        this.region = { x: f.x, y: f.y, w: f.w, h: f.h };
        const card = { steps: this.steps.map((s) => s.text), current: this.index, total: this.steps.length };
        await this.overlay.guide(card, { x: f.cx, y: f.cy }, { type: 'box', x: f.x, y: f.y, w: f.w, h: f.h, label: '' });
      }
    } catch (e) {
      if (this.live && ++this.misses === MISSES) this.requestReplan(`The highlighted "${step.name}" is no longer on screen.`);
    } finally {
      this.polling = false;
    }
  }

  // Ask the app to have the model look at the screen and correct the plan. Rate limited, so a user who just clicks
  // around is not met with a model call every time.
  requestReplan(reason) {
    if (!this.live || !this.onReplan || this.replans >= MAX_REPLANS) return false;
    const t = this.now();
    if (t - this.lastReplan < REPLAN_GAP_MS) return false;
    this.lastReplan = t;
    this.replans++;
    Promise.resolve(this.onReplan({ goal: this.goal, steps: this.steps.map((s) => s.text), index: this.index, reason })).catch(() => {});
    return true;
  }

  // The marks are gone (Esc, a timeout, an unrelated request): the guide is over.
  deactivate() {
    this.live = false;
    this.region = null;
    this.replans = 0;
    this.lastReplan = -Infinity;
    clearTimeout(this.timer);
    clearTimeout(this.replanTimer);
    clearInterval(this.poll);
    this.poll = null;
  }

  stop() {
    this.deactivate();
    this.overlay.clear();
  }
}

module.exports = { Guide };
