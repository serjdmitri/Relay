// The documents as the rest of Relay uses them: what the voice tools say back (tools()), and what the phone's API calls (remote()). The store does the work;
// this file words the answers, opens a page as a hologram, and draws the pages in the background so the phone is quick to open them.

const os = require('os');
const path = require('path');

const tilde = (p) => String(p).replace(os.homedir(), '~');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

class DocumentsService {
  // store: DocumentStore; getHolos(): the hologram manager (or null while holograms are off)
  constructor({ store, getHolos = () => null, onChange = () => {} }) {
    this.store = store;
    this.getHolos = getHolos;
    this.onChange = onChange;
  }

  // Draws every page of the document's current version, one after another, without making anyone wait for it.
  warm(id) {
    const run = async () => {
      const n = this.store.detail(id).pages;
      for (let i = 0; i < n; i++) await this.store.pageImage(id, i);
    };
    return run().catch(() => {}); // a page that cannot be drawn now is drawn when the phone asks for it
  }

  // Page 1-based, as spoken; 0-based for the store.
  async hologramOf(id, page) {
    const holos = this.getHolos();
    if (!holos) throw new Error('Holograms are turned off.');
    const doc = this.store.find(id);
    const total = this.store.pagesOf(doc).length;
    const n = page === undefined || page === null || page === '' ? 1 : Number(page);
    if (!Number.isInteger(n) || n < 1 || n > total) throw new Error(`There is no page ${page}; ${doc.title} has ${plural(total, 'page')}.`);
    const { bytes } = await this.store.pageImage(doc.id, n - 1);
    const title = `${doc.title} · page ${n}`;
    const holoId = await holos.show({ title, items: [{ kind: 'image', title, credit: 'Relay Documents', bytes, mime: 'image/png' }] });
    return { holoId, title, page: n, pages: total };
  }

  // The tools the model calls: each returns a sentence (or text to read) for the model to answer from.
  tools() {
    const s = this.store;
    return {
      create: async ({ title, pages }) => {
        const d = await s.create({ title, pages });
        this.warm(d.id).then(() => this.onChange());
        this.onChange();
        return `Saved "${d.title}" (${plural(d.pages, 'page')}) as a Word file: ${tilde(d.docx)}. It is shown in Finder and on the phone under Documents.`;
      },
      list: async () => {
        const all = s.all();
        if (!all.length) return 'There are no documents yet.';
        return all.slice(0, 20).map((d) => { const x = s.summary(d); return `${d.title} (${plural(x.pages, 'page')}, version ${x.version}${x.pending ? ', a change is waiting to be approved' : ''}) ${tilde(x.docx)}`; }).join('\n');
      },
      read: async ({ doc } = {}) => { const r = s.read(doc); return `${r.title} (version ${r.version}${r.pending ? ', a change is waiting to be approved' : ''}):\n\n${r.text}`; },
      edit: async ({ doc, changes } = {}) => {
        const r = await s.edit(doc, changes);
        this.warm(r.id).then(() => this.onChange());
        this.onChange();
        return `Changed "${r.title}": ${r.note}. It is version ${r.version} and it is live in the Word file, but it waits for Approve or Reject on the phone under Documents (or say "approve it" or "undo that change"). The old version is kept.`;
      },
      review: async ({ doc, action } = {}) => {
        const a = String(action || '').toLowerCase().startsWith('rej') ? 'reject' : 'approve';
        const r = await s.review(doc, a);
        if (a === 'reject') this.warm(r.id);
        this.onChange();
        return a === 'reject' ? `Put the earlier pages of "${r.title}" back (now version ${r.version}). The rejected change is kept in its history.` : `Kept the change to "${r.title}".`;
      },
      hologram: async ({ doc, page } = {}) => {
        const r = await this.hologramOf(s.find(doc).id, page);
        return `Showing page ${r.page} of ${r.pages} of "${r.title.split(' · ')[0]}" as a hologram.`;
      }
    };
  }

  // What the phone's API calls. Errors are sentences for the person.
  remote() {
    const s = this.store;
    return {
      list: () => s.all().map((d) => { try { return { ...s.summary(d), folder: path.basename(d.folder) }; } catch { return null; } }).filter(Boolean),
      detail: (id) => s.detail(id),
      page: (id, i) => s.pageImage(id, i),
      hologram: (id, page) => this.hologramOf(id, page),
      reorder: async (id, order) => { await s.reorder(id, order); this.onChange(); return s.detail(id); },
      review: async (id, action) => { const r = await s.review(id, action); if (action === 'reject') this.warm(r.id); this.onChange(); return s.detail(id); }
    };
  }
}

module.exports = { DocumentsService, tilde };
