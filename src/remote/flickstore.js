// Hands photos picked on the home page over to the Flick page. A photo picker only opens from a tap, so the home button opens it and the Flick page takes what was picked.
// The photos wait in the browser's own storage (IndexedDB) for a moment and are removed as soon as the Flick page has them.

const FlickStore = {
  open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('relay-flick', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('pending');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Could not open storage.'));
    });
  },

  async put(files) {
    const db = await this.open();
    const list = [...files].map((f) => ({ blob: f, name: f.name || '', type: f.type || '' }));
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite');
      tx.objectStore('pending').put(list, 'files');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Could not keep the photos.')); };
    });
  },

  // The waiting photos (as File objects), removed from storage. An empty list when there are none.
  async take() {
    const db = await this.open();
    return new Promise((resolve) => {
      const tx = db.transaction('pending', 'readwrite');
      const store = tx.objectStore('pending');
      const req = store.get('files');
      req.onsuccess = () => { store.delete('files'); };
      tx.oncomplete = () => {
        db.close();
        const list = Array.isArray(req.result) ? req.result : [];
        resolve(list.filter((x) => x && x.blob).map((x) => new File([x.blob], x.name || 'photo', { type: x.type || x.blob.type || '' })));
      };
      tx.onerror = () => { db.close(); resolve([]); };
    });
  }
};

if (typeof module !== 'undefined') module.exports = { FlickStore };
