// Lowers the system volume while Relay listens, and puts it back. Written so the volume cannot get stuck low:
//  - the original volume is saved to disk before it is lowered, so a crash or a quit does not lose it;
//  - it is restored whenever Relay stops listening, by whatever way, and again at launch and quit if it was left low;
//  - if you changed the volume yourself in the meantime, your setting is left alone.

const LOW_ENOUGH = 20; // below this there is nothing worth lowering
const NEAR = 4; // how close counts as "still where Relay put it"

class Ducker {
  // osa(script): runs AppleScript and returns its text. getEnabled(): the setting. load()/save(v): the saved original or null.
  constructor({ osa, getEnabled, load = () => null, save = () => {}, factor = 0.3, log = console }) {
    this.osa = osa;
    this.getEnabled = getEnabled;
    this.load = load;
    this.save = save;
    this.factor = factor;
    this.log = log;
    this.original = null;
    this.level = null;
    this.chain = Promise.resolve();
  }

  get active() {
    return this.original !== null;
  }

  volume() {
    return this.osa('output volume of (get volume settings)').then(Number);
  }

  duck() {
    if (!this.getEnabled()) return this.chain;
    this.chain = this.chain.then(async () => {
      if (this.original !== null) return;
      try {
        const v = await this.volume();
        if (!Number.isFinite(v) || v <= LOW_ENOUGH) return;
        this.original = v;
        this.level = Math.round(v * this.factor);
        this.save(v); // before lowering: whatever happens next, the way back is on disk
        await this.osa(`set volume output volume ${this.level}`);
      } catch (e) {
        this.log.error?.('duck:', e.message);
        this.original = null;
        this.save(null);
      }
    });
    return this.chain;
  }

  restore() {
    this.chain = this.chain.then(async () => {
      if (this.original === null) return;
      const original = this.original;
      const level = this.level;
      this.original = null;
      this.level = null;
      try {
        const now = await this.volume();
        if (Number.isFinite(now) && Math.abs(now - level) <= NEAR) await this.osa(`set volume output volume ${original}`);
      } catch (e) {
        this.log.error?.('unduck:', e.message);
      } finally {
        this.save(null);
      }
    });
    return this.chain;
  }

  // At launch: the last run may have ended while the volume was low.
  async recover() {
    const saved = this.load();
    if (saved === null || saved === undefined) return false;
    try {
      const now = await this.volume();
      const low = Math.round(saved * this.factor);
      if (Number.isFinite(now) && now < saved && Math.abs(now - low) <= NEAR) await this.osa(`set volume output volume ${saved}`);
    } catch (e) {
      this.log.error?.('duck recover:', e.message);
    }
    this.save(null);
    return true;
  }

  // At quit there is no time to wait for an async script: run one synchronously.
  restoreNow(runSync) {
    if (this.original === null) return;
    try {
      const now = Number(runSync('output volume of (get volume settings)'));
      if (Number.isFinite(now) && Math.abs(now - this.level) <= NEAR) runSync(`set volume output volume ${this.original}`);
    } catch {}
    this.original = null;
    this.level = null;
    this.save(null);
  }
}

module.exports = { Ducker };
