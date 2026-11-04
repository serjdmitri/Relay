// "I am recording a new shortcut": while it is on, Relay's shortcuts and "Hey Jarvis" are paused so a key you press to record is not also obeyed. It must never stay on by accident: if the
// settings window is closed, reloaded or loses focus while recording, nothing tells the main process, and shortcuts plus "Hey Jarvis" would stay dead until Relay restarts. So it expires on
// its own, and the window clears it when it goes away.
class CaptureLatch {
  // onChange(on): called only when the value changes. maxMs: the longest a shortcut recording can last.
  constructor({ onChange = () => {}, maxMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { onChange, maxMs, setTimer, clearTimer });
    this.on = false; this.timer = null;
  }
  set(on) {
    on = !!on;
    this.clearTimer(this.timer); this.timer = null;
    if (on) { this.timer = this.setTimer(() => this.set(false), this.maxMs); this.timer?.unref?.(); }
    if (on === this.on) return;
    this.on = on; this.onChange(on);
  }
  clear() { this.set(false); }
}

module.exports = { CaptureLatch };
