// Hand control that a fist turned on turns itself off again once no hand has been in view for a while (set in Settings), so it is never left watching. Hand control you turned on yourself
// (Settings, the menu bar, saying "hands") is not touched. The clock and the actions are passed in, so all of it is tested.

class HandsAutoOff {
  // isOn(): is hand control on. off(): turn it off. getSeconds(): how long without a hand. note(): tell the user it went off.
  constructor({ isOn, off, getSeconds = () => 90, note = () => {}, now = Date.now }) {
    Object.assign(this, { isOn, off, getSeconds, note, now });
    this.byFist = false; this.lastSeenAt = 0;
  }

  // A fist turned hand control on: start counting from now.
  started() { this.byFist = true; this.lastSeenAt = this.now(); }
  // Someone turned it on, or off, some other way: leave it alone.
  manual() { this.byFist = false; }
  // A hand is in view (called for every picture that has one).
  seen() { this.lastSeenAt = this.now(); }

  // Called every few seconds. Returns true when it turned hand control off.
  async tick() {
    if (!this.byFist) return false;
    if (!this.isOn()) { this.byFist = false; return false; }
    const seconds = Math.max(15, Math.min(600, Number(this.getSeconds()) || 90));
    if (this.now() - this.lastSeenAt < seconds * 1000) return false;
    this.byFist = false;
    await this.off();
    this.note();
    return true;
  }
}

module.exports = { HandsAutoOff };
