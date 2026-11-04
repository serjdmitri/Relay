// The intruder log: when the access-denied alarm starts for a real stranger (never the test screen), Relay takes up to three pictures of the camera view and keeps them, so that when
// you come back it can tell you someone was there, show you who, and say whether the same person came before.
//
// Honest limits: Relay cannot know a stranger's NAME. It shows the pictures, and compares the stranger's face numbers with earlier visits ("the same person as on Tuesday"); if you
// give a visit a name, later visits by the same face are shown with it. The pictures are encrypted on this Mac the same way your face data is (the Mac's keychain-backed safeStorage),
// kept as separate files, and only the newest 30 visits within 60 days are kept. Nothing is sent anywhere.
//
// The store holds only small records: { id, at, seconds, outcome, shots: [{ file, t }], emb, label, sameAs, reviewed }. `emb` is the stranger's face numbers, encrypted.
const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');

const MAX_SHOTS = 3, MAX_JPEG = 600 * 1024; // a 640x480 frame is about 60 KB; anything much bigger is not one of ours
const OUTCOMES = new Set(['ongoing', 'owner-returned', 'fingerprint', 'trusted', 'locked', 'ended']);
const dot = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y) || 1); };
const okEmb = (e) => Array.isArray(e) && e.length === 128 && e.every(Number.isFinite);

class IntruderLog {
  // encrypt(text): Buffer. decrypt(buffer): text. Both may throw when the keychain is unavailable; nothing is then written.
  constructor({ store, dir, encrypt, decrypt, fs = nodeFs, path = nodePath, now = Date.now, max = 30, keepDays = 60 }) {
    Object.assign(this, { store, dir, encrypt, decrypt, fs, path, now, max, keepDays });
  }

  records() { const r = this.store.get('intruderLog'); return Array.isArray(r) ? r : []; }
  save(list) { this.store.set('intruderLog', list); }

  // What the screen and the voice may see: no file names, no face numbers.
  list() { return this.records().map(({ id, at, seconds, outcome, label, sameAs, reviewed, shots }) => ({ id, at, seconds, outcome, label: label || '', sameAs: sameAs || null, reviewed: !!reviewed, photos: (shots || []).length })).sort((a, b) => b.at - a.at); }

  begin(seconds = 20) {
    const id = crypto.randomBytes(6).toString('hex');
    this.save([...this.records(), { id, at: this.now(), seconds: Number(seconds) || 0, outcome: 'ongoing', shots: [], emb: '', label: '', sameAs: null, reviewed: false }]);
    this.prune();
    return id;
  }

  // jpeg: a "data:image/jpeg;base64,..." string from the camera page. embeddings: the face numbers of the stranger(s) in it. -> true when kept.
  addShot(id, { jpeg, embeddings = [] } = {}, { threshold = 0.363 } = {}) {
    const list = this.records(), rec = list.find((r) => r.id === id);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(jpeg || ''));
    if (!rec || !m || rec.shots.length >= MAX_SHOTS || m[1].length > MAX_JPEG * 1.4) return false;
    try {
      this.fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const file = `${id}-${rec.shots.length + 1}.bin`;
      this.fs.writeFileSync(this.path.join(this.dir, file), this.encrypt(m[1]), { mode: 0o600 });
      rec.shots.push({ file, t: this.now() });
      const good = (embeddings || []).filter(okEmb).slice(0, 2);
      if (good.length) {
        const have = this.readEmb(rec);
        rec.emb = this.encrypt(JSON.stringify([...have, ...good].slice(0, 4).map((e) => e.map((x) => Math.round(x * 1e5) / 1e5)))).toString('base64');
        if (!rec.sameAs) { const hit = this.match(good, { threshold, exclude: id }); if (hit) { rec.sameAs = hit.id; if (!rec.label && hit.label) rec.label = hit.label; } }
      }
      this.save(list);
      return true;
    } catch { return false; }
  }

  readEmb(rec) { try { return rec.emb ? JSON.parse(this.decrypt(Buffer.from(rec.emb, 'base64'))) : []; } catch { return []; } }

  // The earlier visit whose face matches one of these, or null. -> { id, label, at, score }
  match(embeddings, { threshold = 0.363, exclude = null } = {}) {
    let best = null;
    for (const rec of this.records()) {
      if (rec.id === exclude) continue;
      for (const old of this.readEmb(rec)) for (const e of embeddings) { if (!okEmb(e) || !okEmb(old)) continue; const s = dot(e, old); if (s >= threshold && (!best || s > best.score)) best = { id: rec.id, label: rec.label || '', at: rec.at, score: s }; }
    }
    return best;
  }

  finish(id, outcome) {
    const list = this.records(), rec = list.find((r) => r.id === id);
    if (!rec || rec.outcome !== 'ongoing') return;
    rec.outcome = OUTCOMES.has(outcome) ? outcome : 'ended';
    if (!rec.shots.length) { this.save(list.filter((r) => r.id !== id)); return; } // nothing was captured (the camera was not available): there is nothing to tell you about
    this.save(list);
  }

  // Visits you have not been told about yet (finished, with at least one picture).
  pending() { return this.list().filter((r) => !r.reviewed && r.outcome !== 'ongoing' && r.photos > 0).sort((a, b) => a.at - b.at); }
  markReviewed(ids) { const set = new Set(ids); const list = this.records(); for (const r of list) if (set.has(r.id)) r.reviewed = true; this.save(list); }

  // A name for the person in this visit. Earlier and later visits by the same face carry it too.
  setLabel(id, name) {
    const label = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), list = this.records(), rec = list.find((r) => r.id === id);
    if (!rec) return false;
    rec.label = label;
    for (const r of list) if (r.sameAs === id || rec.sameAs === r.id) r.label = label;
    this.save(list); return true;
  }

  // The pictures of one visit as data URLs. Unreadable ones are skipped.
  photos(id) {
    const rec = this.records().find((r) => r.id === id), out = [];
    for (const s of (rec && rec.shots) || []) { try { out.push({ t: s.t, src: 'data:image/jpeg;base64,' + this.decrypt(this.fs.readFileSync(this.path.join(this.dir, s.file))) }); } catch { /* a missing or unreadable file */ } }
    return out;
  }

  remove(id) {
    const rec = this.records().find((r) => r.id === id);
    if (!rec) return false;
    for (const s of rec.shots || []) { try { this.fs.rmSync(this.path.join(this.dir, s.file), { force: true }); } catch { /* gone */ } }
    this.save(this.records().filter((r) => r.id !== id).map((r) => (r.sameAs === id ? { ...r, sameAs: null } : r)));
    return true;
  }

  clear() { for (const r of [...this.records()]) this.remove(r.id); try { this.fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* gone */ } this.save([]); }

  // Newest 30, and nothing older than 60 days.
  prune() {
    const cutoff = this.now() - this.keepDays * 86400000, sorted = [...this.records()].sort((a, b) => b.at - a.at);
    for (const r of sorted.filter((x, i) => i >= this.max || x.at < cutoff)) this.remove(r.id);
  }

  // One sentence about a visit, for the notice and the voice.
  describe(entry, { locale = 'en-US' } = {}) {
    const when = new Date(entry.at), time = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const day = new Date(this.now()).toDateString() === when.toDateString() ? 'at' : `on ${when.toLocaleDateString(locale, { weekday: 'long' })} at`;
    const who = entry.label ? `${entry.label} (a face you named)` : entry.sameAs ? 'someone I have seen before' : 'someone I do not recognise';
    const what = { 'owner-returned': 'The alarm stopped when you came back.', fingerprint: 'You stopped it with your fingerprint.', trusted: 'A trusted person arrived and the alarm stopped.', locked: `I locked the screen after ${entry.seconds} seconds.`, ended: 'The alarm ended.', ongoing: '' }[entry.outcome] || '';
    return `${who[0].toUpperCase()}${who.slice(1)} was at your Mac ${day} ${time}. I took ${entry.photos} picture${entry.photos === 1 ? '' : 's'}. ${what}`.trim();
  }
}

module.exports = { IntruderLog, MAX_SHOTS };
