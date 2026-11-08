// A small diagnostics log on this Mac: what Relay did about itself, one line per event. It exists because "Jarvis stopped listening" was impossible to explain afterwards: nothing was written down.
// Lines look like "2026-11-08T09:14:02.331Z wake-restarted not listening after unlock". Only events and short reasons: never spoken words, file contents or anything personal. It rotates, so it
// cannot grow without limit, and nothing leaves the Mac.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 400 * 1024;

class Diag {
  constructor({ file, now = () => new Date(), fsImpl = fs } = {}) { Object.assign(this, { file, now, fs: fsImpl }); }

  log(kind, message = '') {
    if (!this.file) return false;
    const line = `${this.now().toISOString()} ${String(kind).replace(/[^a-z0-9._-]/gi, '-').slice(0, 40)} ${String(message).replace(/[\u0000-\u001f]+/g, ' ').slice(0, 240)}\n`;
    try {
      this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
      try { if (this.fs.statSync(this.file).size > MAX_BYTES) { this.fs.renameSync(this.file, this.file + '.1'); } } catch { /* no file yet */ }
      this.fs.appendFileSync(this.file, line, { mode: 0o600 });
      return true;
    } catch { return false; }
  }

  // The last n lines, newest last.
  tail(n = 12) {
    try { return this.fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
  }

  // Plain words for "what happened": the last few events, with how long ago each was.
  describe(n = 8) {
    const lines = this.tail(n);
    if (!lines.length) return 'Nothing has been logged yet. When I restart my listening, lock, unlock or sound the alarm, it is written down here.';
    const now = this.now().getTime();
    const ago = (iso) => { const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); return s < 90 ? `${s} seconds ago` : s < 5400 ? `${Math.round(s / 60)} minutes ago` : `${Math.round(s / 3600)} hours ago`; };
    return 'Here is what I last did about myself. ' + lines.map((l) => { const [t, kind, ...rest] = l.split(' '); return `${ago(t)}: ${kind.replace(/-/g, ' ')}${rest.length ? ', ' + rest.join(' ') : ''}`; }).join('. ') + '.';
  }
}

function parseDiagCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:what (?:just )?happened(?: with you)?|what have you been doing|show (?:me )?(?:the |your )?(?:diagnostics|diagnostic log|log)|are you (?:ok|okay|working|alive|listening)|diagnostics)$/.test(n)) return { type: 'diag-show' };
  return null;
}

module.exports = { Diag, parseDiagCommand, MAX_BYTES };
