// Is the Mac locked right now? The phone page shows it as an open or a closed padlock. macOS tells Electron when the screen locks and unlocks; a slow check of the
// session (ioreg) catches a lock that happened while Relay was not listening. Pure: the command is passed in.

// "CGSSessionScreenIsLocked" = Yes shows up in the login session's properties only while the screen is locked.
const parseLocked = (text) => /"CGSSessionScreenIsLocked"\s*=\s*(?:Yes|true|1)\b/i.test(String(text || ''));

class LockWatch {
  constructor({ exec, onChange = () => {} } = {}) {
    this.exec = exec;
    this.onChange = onChange;
    this.locked = false;
  }

  set(v) {
    const on = !!v;
    if (on === this.locked) return false;
    this.locked = on;
    this.onChange(on);
    return true;
  }

  async refresh() {
    try { this.set(parseLocked(await this.exec('ioreg', ['-n', 'Root', '-d1']))); } catch { /* keep what the events said */ }
    return this.locked;
  }
}

module.exports = { LockWatch, parseLocked };
