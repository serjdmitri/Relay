// Bounded metadata-only scanning runs off the app thread. Never reads file contents or follows links/mounts.
const fs = require('fs');
const path = require('path');
const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');
const { inside } = require('./access');
async function scanTree(root, { io = fs.promises, maxEntries = 20000, maxDepth = 24, maxMs = 15000, progress = () => {}, now = Date.now } = {}) {
  const start = now(), stats = { files: 0, entries: 0, skipped: 0, unreadable: 0, partial: false };
  const rootStat = await io.lstat(root); let tick = 0;
  const walk = async (p, depth) => {
    const node = { id: String(stats.entries++), name: path.basename(p), path: p, bytes: 0, children: [] };
    const skip = reason => { stats.skipped++; stats.partial = true; node.reason = reason; return node; };
    if (stats.entries > maxEntries || now() - start >= maxMs) return skip('Scan limit reached');
    if (now() - tick > 200) { tick = now(); progress({ ...stats }); }
    try {
      const st = await io.lstat(p); node.dev = st.dev; node.ino = st.ino;
      if (st.isSymbolicLink()) return skip('Symbolic link excluded');
      if (st.dev !== rootStat.dev) return skip('Another mounted filesystem excluded');
      if (!st.isDirectory()) { if (st.isFile()) { node.bytes = st.size; stats.files++; node.file = true; } else return skip('Special file excluded'); return node; }
      node.directory = true;
      if (depth && (node.name.startsWith('.') || node.name === 'Library' || /\.(app|bundle|framework|photoslibrary|musiclibrary)$/i.test(node.name))) return skip('Protected folder or package excluded');
      if (depth >= maxDepth) return skip('Depth limit reached');
      if (await io.realpath(p) !== p) return skip('Folder path changed or contains a link');
      const dir = await io.opendir(p);
      try {
        for await (const entry of dir) {
          if (stats.entries >= maxEntries || now() - start >= maxMs) { stats.partial = true; node.reason = 'Scan limit reached'; break; }
          const child = await walk(path.join(p, entry.name), depth + 1); node.children.push(child); node.bytes += child.bytes;
        }
      } finally { await dir.close().catch(() => {}); }
    } catch (e) { stats.unreadable++; stats.partial = true; node.reason = `Could not read (${e.code || 'unavailable'})`; }
    return node;
  };
  const tree = await walk(root, 0);
  return { tree, ...stats, scannedAt: Date.now(), durationMs: now() - start };
}
class StorageScan {
  constructor({ access, reveal = () => {}, worker = options => new Worker(__filename, options) }) { Object.assign(this, { access, reveal, worker }); this.state = { status: 'idle' }; }
  start(id) {
    this.cancel(); const root = this.access.require(id);
    this.rootId = id; this.nodes = new Map(); this.state = { status: 'scanning', files: 0, entries: 0 };
    const job = this.worker({ workerData: { root: root.path } }); this.job = job;
    const end = () => { clearTimeout(this.timer); this.job = null; };
    this.timer = setTimeout(() => { if (this.job === job) { this.cancel(); this.state = { status: 'error', error: 'Drive did not finish responding. No complete map is available; reconnect it and try again.' }; } }, 20000);
    job.on('message', message => {
      if (this.job !== job) return;
      if (message.progress) { this.state = { status: 'scanning', ...message.progress }; return; }
      if (message.error) { this.state = { status: 'error', error: message.error }; end(); return; }
      try {
        this.access.require(id);
        const index = (node, parent = null) => { this.nodes.set(node.id, { ...node, parent }); node.children.forEach(c => index(c, node.id)); }; index(message.tree);
        const { tree, ...stats } = message; this.state = { status: 'ready', ...stats };
      } catch (e) { this.state = { status: 'error', error: e.message }; this.nodes.clear(); }
      end();
    });
    job.on('error', e => { if (this.job === job) { this.state = { status: 'error', error: e.message }; end(); } });
    job.on('exit', code => { if (this.job === job) { this.state = { status: 'error', error: `Scan stopped before a map was ready (${code}).` }; end(); } });
    return this.state;
  }
  cancel() { clearTimeout(this.timer); if (this.job) { const job = this.job; this.job = null; job.terminate(); } this.nodes = new Map(); this.state = { status: 'cancelled' }; return this.state; }
  view(id = '0') {
    if (this.state.status !== 'ready') return this.state;
    const root = this.access.require(this.rootId), node = this.nodes.get(String(id));
    if (!node || !inside(root.path, node.path)) throw new Error('Choose a folder from this scan.');
    const summary = n => ({ id: n.id, name: n.name, bytes: n.bytes, directory: !!n.directory, file: !!n.file, reason: n.reason });
    const crumbs = []; let at = node;
    while (at) { crumbs.unshift({ id: at.id, name: at.name }); at = this.nodes.get(at.parent); }
    return { ...this.state, node: { ...summary(node), path: node.path }, crumbs, children: node.children.map(summary).sort((a,b) => b.bytes - a.bytes || a.name.localeCompare(b.name)) };
  }
  revealNode(id) {
    const root = this.access.require(this.rootId), node = this.nodes.get(String(id));
    if (!node || !inside(root.path, node.path)) throw new Error('Choose a file from the current map.');
    const st = fs.lstatSync(node.path);
    if (st.isSymbolicLink() || fs.realpathSync(node.path) !== node.path || st.dev !== node.dev || st.ino !== node.ino) throw new Error('That path changed. Refresh the scan before opening Finder.');
    this.reveal(node.path); return { ok: true };
  }
}
function isStorageRequest(text) {
  const request = String(text).trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  return /^(?:(?:hey\s+)?(?:jarvis|relay)[, ]+)?(?:please\s+)?(?:(?:show|open|check)(?: me)? (?:the |my )?(?:storage|disk)(?: usage)?(?: map| chart)?|what(?:'s|s| is) (?:filling(?: up)?|taking up|using)(?: all)? (?:my |the )?(?:storage(?: space)?|disk(?: space)?|space|hard drive|ssd))[.!?]*$/i.test(request);
}
if (!isMainThread && workerData?.root) scanTree(workerData.root, { progress: progress => parentPort.postMessage({ progress }) }).then(result => parentPort.postMessage(result), e => parentPort.postMessage({ error: `Scan unavailable (${e.code || e.message}).` }));
module.exports = { scanTree, StorageScan, isStorageRequest };
