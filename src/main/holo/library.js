// The hologram library and saved scenes.
//
// The library keeps every hologram that has been on screen (pinned or not), with a small picture, so "show my holograms" and "find my hologram of the
// car" work. A scene is the set of holograms on screen, with where each one is and how big, saved under a name and brought back with one phrase.
// Pure data handling here; the manager does the showing. No Electron.

const { toSaved, cleanSaved } = require('./logic');

const MAX_LIBRARY = 60;
const MAX_SCENES = 20;
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// A saved hologram that can be shown again (cleanSaved wants it pinned; the library keeps it as it was, pinned or not).
const restorable = (saved) => cleanSaved([{ ...saved, pinned: true }]).length === 1;

class HoloLibrary {
  // storage: { get(key), set(key, value) } over the store; keys 'holoLibrary' and 'holoScenes'.
  constructor({ storage, now = Date.now }) {
    this.storage = storage;
    this.now = now;
  }

  get entries() { return this.storage.get('holoLibrary') || []; }
  get scenes() { return this.storage.get('holoScenes') || []; }

  // Keeps the library in step with what is on screen: new ones are added, changed ones updated (their picture stays). holos: [{ id, saved, pinned }].
  sync(holos) {
    let list = [...this.entries];
    let changed = false;
    for (const h of holos) {
      if (!h?.saved || !restorable(h.saved)) continue;
      const saved = { ...h.saved, pinned: !!h.pinned };
      const i = list.findIndex((e) => e.id === h.id);
      const json = JSON.stringify(saved);
      if (i >= 0) {
        if (JSON.stringify(list[i].saved) === json) continue;
        list[i] = { ...list[i], title: saved.title, saved, updatedAt: this.now() };
      } else {
        list.push({ id: h.id, title: saved.title, saved, thumb: '', createdAt: this.now(), updatedAt: this.now() });
      }
      changed = true;
    }
    if (list.length > MAX_LIBRARY) { list = list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LIBRARY); changed = true; }
    if (changed) this.storage.set('holoLibrary', list);
    return changed;
  }

  setThumb(id, thumb) {
    const list = this.entries;
    const i = list.findIndex((e) => e.id === id);
    if (i < 0 || typeof thumb !== 'string' || thumb.length > 40000) return false;
    list[i] = { ...list[i], thumb };
    this.storage.set('holoLibrary', list);
    return true;
  }

  get(id) { return this.entries.find((e) => e.id === id) || null; }
  recent(limit = 8) { return [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit); }

  // Words from the question against the title and the names of the models inside it. Best matches first; nothing that matches no word.
  search(query, limit = 8) {
    const words = clean(query).split(' ').filter((w) => w.length > 1 && !['the', 'my', 'of', 'a', 'an', 'hologram', 'holograms', 'model', 'models'].includes(w));
    if (!words.length) return this.recent(limit);
    const scored = [];
    for (const e of this.entries) {
      const hay = clean(`${e.title} ${(e.saved.items || []).map((i) => i.title).join(' ')}`);
      const hw = hay.split(' ');
      let score = 0;
      let all = true;
      for (const w of words) {
        const s1 = hw.includes(w) ? 3 : hw.some((x) => x.startsWith(w) || (w.startsWith(x) && x.length > 3)) ? 2 : hay.includes(w) ? 1 : 0;
        if (!s1) all = false;
        score += s1;
      }
      if (all) scored.push({ e, score, t: e.updatedAt });
    }
    return scored.sort((a, b) => b.score - a.score || b.t - a.t).slice(0, limit).map((s) => s.e);
  }

  remove(id) {
    const list = this.entries.filter((e) => e.id !== id);
    if (list.length === this.entries.length) return false;
    this.storage.set('holoLibrary', list);
    return true;
  }

  // ----- scenes -----
  findScene(name) {
    const want = clean(name);
    return this.scenes.find((s) => clean(s.name) === want) || this.scenes.find((s) => clean(s.name).includes(want) || (want && want.includes(clean(s.name))));
  }

  // holos: [{ saved, pinned }] as they are on screen now. Returns { ok, replaced, count } or { ok: false, reason }.
  saveScene(name, holos) {
    const items = holos.filter((h) => h?.saved && restorable(h.saved)).map((h) => ({ ...h.saved, pinned: !!h.pinned }));
    if (!items.length) return { ok: false, reason: holos.length ? 'None of the holograms on screen can be saved in a scene (they were made from files that are not kept).' : 'There are no holograms on screen to save.' };
    const nm = String(name).trim().slice(0, 40);
    const replaced = this.scenes.some((s) => clean(s.name) === clean(nm));
    const list = [...this.scenes.filter((s) => clean(s.name) !== clean(nm)), { name: nm, savedAt: this.now(), holos: items }].slice(-MAX_SCENES);
    this.storage.set('holoScenes', list);
    return { ok: true, replaced, count: items.length, skipped: holos.length - items.length };
  }

  deleteScene(name) {
    const s = this.findScene(name);
    if (!s) return null;
    this.storage.set('holoScenes', this.scenes.filter((x) => x !== s));
    return s;
  }
}

module.exports = { HoloLibrary, restorable, MAX_LIBRARY };
