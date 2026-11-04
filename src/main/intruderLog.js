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

const LEARN_STREAK = 3, NAME_MATCH = 0.45, AUTO_MATCH = 0.5; // yeses in a row that make a person "learned"; how alike a face must be to be offered as them, and to be named without asking
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
  list() { return this.records().map(({ id, at, seconds, outcome, label, sameAs, reviewed, shots, question, auto }) => ({ id, at, seconds, outcome, label: label || '', sameAs: sameAs || null, reviewed: !!reviewed, photos: (shots || []).length, auto: !!auto, question: question ? { name: question.name, score: question.score } : null })).sort((a, b) => b.at - a.at); }

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
        if (!rec.sameAs) { const hit = this.match(good, { threshold, exclude: id }); if (hit) rec.sameAs = hit.id; } // linked as "seen before"; it is NOT named from that: a name only comes from you, or from a person Relay has learned and confirmed
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
    this.suggest(id); // does this look like someone you have named?
  }

  // Visits you have not been told about yet (finished, with at least one picture).
  pending() { return this.list().filter((r) => !r.reviewed && r.outcome !== 'ongoing' && r.photos > 0).sort((a, b) => a.at - b.at); }
  markReviewed(ids) { const set = new Set(ids); const list = this.records(); for (const r of list) if (set.has(r.id)) r.reviewed = true; this.save(list); }

  // A name for the person in this visit. Earlier and later visits by the same face carry it too.
  setLabel(id, name) {
    const label = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), list = this.records(), rec = list.find((r) => r.id === id);
    if (!rec) return false;
    rec.label = label; rec.auto = false; rec.question = null;
    for (const r of list) if (r.sameAs === id || rec.sameAs === r.id) r.label = label;
    this.save(list);
    if (label) this.learn(label, this.readEmb(rec), { confirm: true }); // naming a visit teaches Relay this face
    return true;
  }

  // ---- people you have named: their faces are learned, suggested for new visits, and (after a few confirmations) recognised by name ----
  // A person is { id, name, enc, confirmed, streak, learned, at }; `enc` holds { samples, rejected } (face numbers, encrypted). You naming a visit adds that face and counts as one
  // confirmation. With two or more confirmations Relay SUGGESTS the name for a new visit that matches ("Is this Alex?"); each yes adds the face and extends a streak, a no records
  // the face as "not them" and resets the streak, and after LEARN_STREAK yeses in a row the person is learned and later visits are named without asking.
  peopleRecords() { const r = this.store.get('intruderPeople'); return Array.isArray(r) ? r : []; }
  savePeople(list) { this.store.set('intruderPeople', list); }
  readPerson(p) { try { const d = JSON.parse(this.decrypt(Buffer.from(p.enc, 'base64'))); return { samples: (d.samples || []).filter(okEmb), rejected: (d.rejected || []).filter(okEmb) }; } catch { return { samples: [], rejected: [] }; } }
  writePerson(p, data) { p.enc = this.encrypt(JSON.stringify({ samples: data.samples.map((e) => e.map((x) => Math.round(x * 1e5) / 1e5)), rejected: data.rejected.map((e) => e.map((x) => Math.round(x * 1e5) / 1e5)) })).toString('base64'); }

  people() { return this.peopleRecords().map((p) => ({ id: p.id, name: p.name, confirmed: p.confirmed, learned: !!p.learned, faces: this.readPerson(p).samples.length })); }

  // Add this face to the named person (creating them if new). confirm: count it as one confirmation; streak: it was a yes to a suggestion.
  learn(name, embeddings, { confirm = true, streak = false } = {}) {
    const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), good = (embeddings || []).filter(okEmb);
    if (!clean || !good.length) return null;
    const list = this.peopleRecords();
    let p = list.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    if (!p) { p = { id: crypto.randomBytes(6).toString('hex'), name: clean, enc: '', confirmed: 0, streak: 0, learned: false, at: this.now() }; list.push(p); }
    try {
      const data = this.readPerson(p);
      for (const e of good) if (!data.samples.some((s) => dot(s, e) >= 0.97)) data.samples.push(e); // a copy of a face already kept adds nothing
      data.samples = data.samples.slice(-12); this.writePerson(p, data);
    } catch { return null; }
    if (confirm) p.confirmed++;
    if (streak) { p.streak++; if (p.streak >= LEARN_STREAK) p.learned = true; }
    this.savePeople(list);
    return { id: p.id, name: p.name, confirmed: p.confirmed, streak: p.streak, learned: !!p.learned };
  }

  // Who do these faces look like among the people learned so far? Needs two confirmations and a clear lead over the next person. -> { id, name, score, learned } or null
  identify(embeddings) {
    const faces = (embeddings || []).filter(okEmb); let best = null, second = -1;
    if (!faces.length) return null;
    for (const p of this.peopleRecords()) {
      if (p.confirmed < 2) continue;
      const data = this.readPerson(p); let score = -1;
      for (const e of faces) for (const s of data.samples) score = Math.max(score, dot(e, s));
      // a face already said to be "not them" is never offered as them again
      if (faces.some((e) => data.rejected.some((r) => dot(e, r) >= Math.max(score - 0.02, NAME_MATCH)))) continue;
      if (!best || score > best.score) { second = best ? best.score : second; best = { id: p.id, name: p.name, score, learned: !!p.learned }; } else second = Math.max(second, score);
    }
    return best && best.score >= NAME_MATCH && best.score - second >= 0.05 ? best : null;
  }

  // A visit finished: name it (if the person is learned and the match is firm) or ask (if it only looks like someone).
  suggest(id) {
    const list = this.records(), rec = list.find((r) => r.id === id);
    if (!rec || rec.label) return null;
    const hit = this.identify(this.readEmb(rec));
    if (!hit) return null;
    if (hit.learned && hit.score >= AUTO_MATCH) { rec.label = hit.name; rec.auto = true; } else rec.question = { personId: hit.id, name: hit.name, score: Math.round(hit.score * 100) / 100 };
    this.save(list); return hit;
  }

  // The answer to "is this Alex?": yes teaches it the face, no teaches it it is not them.
  answer(id, yes) {
    const list = this.records(), rec = list.find((r) => r.id === id);
    if (!rec || !rec.question) return null;
    const q = rec.question, emb = this.readEmb(rec);
    rec.question = null;
    if (yes) {
      rec.label = q.name; this.save(list);
      const r = this.learn(q.name, emb, { confirm: true, streak: true });
      return { ok: true, yes: true, name: q.name, learned: !!(r && r.learned), streak: r ? r.streak : 0 };
    }
    this.save(list);
    const people = this.peopleRecords(), p = people.find((x) => x.id === q.personId);
    if (p) { try { const data = this.readPerson(p); data.rejected = [...data.rejected, ...emb].slice(-8); this.writePerson(p, data); p.streak = 0; p.learned = false; this.savePeople(people); } catch { /* keep going */ } }
    return { ok: true, yes: false, name: q.name };
  }

  // The newest finished visit that still has a question waiting. -> the list() entry or null
  pendingQuestion() { return this.list().filter((r) => r.question && r.outcome !== 'ongoing' && r.photos > 0).sort((a, b) => b.at - a.at)[0] || null; }

  forgetPerson(idOrName) {
    const key = String(idOrName || '').trim().toLowerCase(), list = this.peopleRecords(), p = list.find((x) => x.id === idOrName || x.name.toLowerCase() === key);
    if (!p) return false;
    this.savePeople(list.filter((x) => x !== p));
    const recs = this.records(); for (const r of recs) { if ((r.label || '').toLowerCase() === p.name.toLowerCase()) { r.label = ''; r.auto = false; } if (r.question && r.question.personId === p.id) r.question = null; }
    this.save(recs); return true;
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
    const who = entry.label ? (entry.auto ? `${entry.label} (I recognised the face from earlier visits)` : `${entry.label} (a face you named)`) : entry.question ? `someone who looks like ${entry.question.name}` : entry.sameAs ? 'someone I have seen before' : 'someone I do not recognise';
    const what = { 'owner-returned': 'The alarm stopped when you came back.', fingerprint: 'You stopped it with your fingerprint.', trusted: 'A trusted person arrived and the alarm stopped.', locked: `I locked the screen after ${entry.seconds} seconds.`, ended: 'The alarm ended.', ongoing: '' }[entry.outcome] || '';
    return `${who[0].toUpperCase()}${who.slice(1)} was at your Mac ${day} ${time}. I took ${entry.photos} picture${entry.photos === 1 ? '' : 's'}. ${what}`.trim();
  }
}

// A plain answer to "is that Alex?" (or a name for a visit nobody asked about): { yes: true }, { yes: false }, { yes: false, name: 'Sam' } ("no, that's Sam"), { name: 'Sam' } ("that's Sam"), or null.
// Only heard while a question is waiting (the controller checks), so a bare "yes" is never taken for anything else.
function parseNamingAnswer(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ');
  const name = (v) => String(v || '').replace(/[^A-Za-z' -]/g, '').trim().slice(0, 40);
  if (/^(?:(?:yes|yeah|yep|yup|correct|right|affirmative)(?:,? (?:please|that is|that'?s|it is|it'?s)(?: (?:him|her|them|right|correct))?)?|that'?s (?:him|her|them|right|correct)|it is|it'?s (?:him|her|them))$/i.test(n)) return { yes: true };
  if (/^(?:no|nope|nah|wrong|incorrect|not (?:him|her|them)|that'?s not (?:him|her|them)|it'?s not (?:him|her|them)|no it'?s not (?:him|her|them)?)$/i.test(n)) return { yes: false };
  let m = /^no,? (?:it'?s|that'?s|this is|that is|it is) ([A-Za-z][A-Za-z' -]{0,30})$/i.exec(n);
  if (m && name(m[1])) return { yes: false, name: name(m[1]) };
  m = /^(?:that'?s|that is|that was|it'?s|it is|it was|this is|his name is|her name is|their name is|call (?:him|her|them)) ([A-Za-z][A-Za-z' -]{0,30})$/i.exec(n);
  if (m && name(m[1]) && !/^(?:fine|ok|okay|good|great|nothing|me|mine|you|it|him|her|them|not|no|yes|alright|all right|enough|done|right|wrong)\b/i.test(name(m[1]))) return { name: name(m[1]) };
  return null;
}

module.exports = { IntruderLog, parseNamingAnswer, MAX_SHOTS, LEARN_STREAK, NAME_MATCH, AUTO_MATCH };
