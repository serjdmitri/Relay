// Light mode: when the Mac is short of memory (it is swapping heavily) or the battery is low and not charging, Relay does less work in the background (the camera is looked at less often, the
// voice model is let go, holograms are drawn smaller, hand control turns itself off sooner) and goes back to normal when things recover. This file only decides WHEN; main.js does the things.
// The thresholds have a gap between "on" and "off" so it does not flicker. The sample and the clock are passed in, so all of it is tested.

class LightMode {
  // sample(): -> { swapUsedMB, swapTotalMB, onBattery, charging, percent } (any field may be missing). onChange(active, reasons): called when it turns on or off. enabled(): the setting.
  constructor({ sample, onChange = () => {}, enabled = () => true }) {
    Object.assign(this, { sample, onChange, enabled });
    this.active = false; this.reasons = [];
  }

  // The reasons light mode is wanted for this sample ([] = none). `already`: it is on now, so it takes more recovery to turn it off.
  static reasonsFor(s, already = false) {
    const out = [];
    if (!s) return out;
    const total = Number(s.swapTotalMB) || 0, used = Number(s.swapUsedMB) || 0;
    // memory: most of the swap file used (and a real amount of it): the Mac is swapping, which is what makes everything slow
    if (total > 0 && used >= 3000 && used / total >= (already ? 0.6 : 0.8)) out.push('memory');
    // battery: not charging and low (a battery on its way to empty), with room to recover before it turns off again
    const pct = Number(s.percent);
    if (s.onBattery && !s.charging && Number.isFinite(pct) && pct <= (already ? 30 : 20)) out.push('battery');
    return out;
  }

  async check() {
    if (!this.enabled()) { this.set(false, []); return this.active; }
    let s = null;
    try { s = await this.sample(); } catch { return this.active; } // no reading: keep things as they are
    const reasons = LightMode.reasonsFor(s, this.active);
    this.set(reasons.length > 0, reasons);
    return this.active;
  }

  set(active, reasons) {
    const changed = active !== this.active;
    this.active = active; this.reasons = reasons;
    if (changed) { try { this.onChange(active, reasons); } catch { /* the caller's problem; the state is kept */ } }
  }
}

module.exports = { LightMode };
