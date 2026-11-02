// Bounded metadata-only scanning runs off the app thread. Never reads file contents or follows links/mounts.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { kindOf } = require('./files');
const { pathProblem } = require('./guard');
const TYPES = { image:'Photos', video:'Videos', audio:'Audio', pdf:'PDFs', document:'Documents', spreadsheet:'Spreadsheets', slides:'Presentations', archive:'Archives', code:'Code', other:'Other' };
const { Worker, parentPort, workerData, isMainThread } = require('worker_threads');
const { inside } = require('./access');
async function scanTree(root, { io = fs.promises, maxEntries = 20000, maxDepth = 24, maxMs = 15000, progress = () => {}, now = Date.now, entireComputer = false } = {}) {
  const start = now(), stats = { files: 0, entries: 0, skipped: 0, unreadable: 0, partial: false };
  const rootStat = await io.lstat(root); let tick = 0;
  const devices = new Set([rootStat.dev]);
  if (entireComputer) { try { devices.add((await io.lstat('/Users')).dev); } catch {} }
  const walk = async (p, depth) => {
    const node = { id: String(stats.entries++), name: path.basename(p), path: p, bytes: 0, children: [] };
    const skip = reason => { stats.skipped++; stats.partial = true; node.reason = reason; return node; };
    if (stats.entries > maxEntries || now() - start >= maxMs) return skip('Scan limit reached');
    if (now() - tick > 200) { tick = now(); progress({ ...stats }); }
    try {
      const st = await io.lstat(p); node.dev = st.dev; node.ino = st.ino;
      if (st.isSymbolicLink()) return skip('Symbolic link excluded');
      if (!devices.has(st.dev)) return skip('Another mounted filesystem excluded');
      if (!st.isDirectory()) { if (st.isFile()) { node.bytes = st.size; node.size = st.size; node.mtimeMs = st.mtimeMs; stats.files++; node.file = true; } else return skip('Special file excluded'); return node; }
      node.directory = true;
      if (entireComputer && ['/System/Volumes','/dev','/Volumes','/Network','/net'].includes(p)) return skip('Virtual, duplicate or separately mounted area excluded');
      if (depth && (node.name.startsWith('.') || !entireComputer && (node.name === 'Library' || /\.(app|bundle|framework|photoslibrary|musiclibrary)$/i.test(node.name)))) return skip('Protected folder or package excluded');
      if (depth >= maxDepth) return skip('Depth limit reached');
      if (await io.realpath(p) !== p) return skip('Folder path changed or contains a link');
      const priority = name => ['Users','Applications','Library','private','System'].indexOf(name);
      const dir = entireComputer && depth === 0 ? (await io.readdir(p, { withFileTypes: true })).sort((a,b) => (priority(a.name)<0?99:priority(a.name))-(priority(b.name)<0?99:priority(b.name))) : await io.opendir(p);
      try {
        for await (const entry of dir) {
          if (stats.entries >= maxEntries || now() - start >= maxMs) { stats.partial = true; node.reason = 'Scan limit reached'; break; }
          const child = await walk(path.join(p, entry.name), depth + 1); node.children.push(child); node.bytes += child.bytes;
        }
      } finally { if (dir.close) await dir.close().catch(() => {}); }
    } catch (e) { stats.unreadable++; stats.partial = true; node.reason = `Could not read (${e.code || 'unavailable'})`; }
    return node;
  };
  const tree = await walk(root, 0);
  return { tree, ...stats, scannedAt: Date.now(), durationMs: now() - start };
}
class StorageScan {
  constructor({ access, reveal = () => {}, worker = options => new Worker(__filename, options), home = os.homedir(), computerRoot = '/' }) { Object.assign(this, { access, reveal, worker, home, computerRoot }); this.state = { status: 'idle' }; }
  requireRoot(id = this.rootId) {
    return id === 'computer' ? { id, path:this.computerRoot, computer:true } : this.access.require(id);
  }
  capacity() {
    try { const st=fs.statfsSync(this.rootId === 'computer' ? this.home : this.requireRoot().path); return { total:st.blocks*st.bsize, available:st.bavail*st.bsize, used:(st.blocks-st.bfree)*st.bsize }; } catch { return null; }
  }
  start(id) {
    this.cancel(); const root = this.requireRoot(id);
    this.rootId = id; this.nodes = new Map(); this.state = { status: 'scanning', files: 0, entries: 0 };
    const job = this.worker({ workerData: { root: root.path, entireComputer: !!root.computer } }); this.job = job;
    const end = () => { clearTimeout(this.timer); this.job = null; };
    this.timer = setTimeout(() => { if (this.job === job) { this.cancel(); this.state = { status: 'error', error: 'Drive did not finish responding. No complete map is available; reconnect it and try again.' }; } }, 20000);
    job.on('message', message => {
      if (this.job !== job) return;
      if (message.progress) { this.state = { status: 'scanning', ...message.progress }; return; }
      if (message.error) { this.state = { status: 'error', error: message.error }; end(); return; }
      try {
        this.requireRoot(id);
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
    const root = this.requireRoot(), files = [...this.nodes.values()].filter(n=>n.file&&!n.removed);
    const summary = n => ({ id:n.id, name:n.name, bytes:n.bytes, directory:!!n.directory, file:!!n.file, reason:n.reason, trashable:n.file&&!this.trashProblem(n,root) });
    if (id === 'types' || String(id).startsWith('category:')) {
      const kind=String(id).slice(9), matching=files.filter(n=>kindOf(n.name)===kind);
      const categories=Object.entries(TYPES).map(([key,name])=>{const list=files.filter(n=>kindOf(n.name)===key);return {id:'category:'+key,name,bytes:list.reduce((n,f)=>n+f.bytes,0),directory:true,count:list.length};}).filter(c=>c.count);
      return {...this.state,capacity:this.capacity(),node:{id,name:id==='types'?'File types':TYPES[kind]||'Files',path:root.path,bytes:(id==='types'?files:matching).reduce((n,f)=>n+f.bytes,0),virtual:true},crumbs:[{id:'types',name:'File types'},...(id==='types'?[]:[{id,name:TYPES[kind]||kind}])],children:(id==='types'?categories:matching.map(summary)).sort((a,b)=>b.bytes-a.bytes)};
    }
    const node=this.nodes.get(String(id));
    if (!node || node.removed || !inside(root.path,node.path)) throw new Error('Choose a folder from this scan.');
    const crumbs=[];let at=node;while(at){crumbs.unshift({id:at.id,name:at.name});at=this.nodes.get(at.parent);}
    return {...this.state,capacity:this.capacity(),node:{...summary(node),path:node.path},crumbs,children:node.children.filter(n=>!this.nodes.get(n.id)?.removed).map(n=>summary(this.nodes.get(n.id))).sort((a,b)=>b.bytes-a.bytes||a.name.localeCompare(b.name))};
  }
  trashProblem(node,root=this.requireRoot()) {
    if (!node?.file || node.removed) return 'Choose a file from the current scan.';
    const base=root.computer?this.home:root.path;
    return pathProblem(node.path,base);
  }
  trashItems(ids) {
    const root=this.requireRoot();
    if(!Array.isArray(ids)||!ids.length||ids.length>100)throw new Error('Select between 1 and 100 files.');
    return [...new Set(ids)].map(id=>{
      const node=this.nodes.get(String(id)),bad=this.trashProblem(node,root);if(bad)throw new Error(bad);
      if(hasLink(node.path,root.computer?this.home:root.path))throw new Error('A selected path contains a symbolic link.');
      const st=fs.lstatSync(node.path);
      if(!st.isFile()||st.dev!==node.dev||st.ino!==node.ino||st.size!==node.size||st.mtimeMs!==node.mtimeMs)throw new Error('A selected file changed. Refresh before moving it to Trash.');
      return node;
    });
  }
  async trash(ids,{confirm,trashItem}) {
    const items=this.trashItems(ids), version=this.nodes;
    if(!await confirm(items.map(n=>({id:n.id,path:n.path,bytes:n.bytes}))))return{cancelled:true,count:0};
    let count=0;const failed=[];
    for(const item of items){try{
      if(this.nodes!==version)throw new Error('Scan changed. Make a new selection.');
      const [current]=this.trashItems([item.id]);await trashItem(current.path);current.removed=true;count++;
      let parent=this.nodes.get(current.parent);while(parent){parent.bytes=Math.max(0,parent.bytes-current.bytes);parent=this.nodes.get(parent.parent);}
    }catch(e){failed.push({path:item.path,error:e.message});}}
    return{count,failed};
  }

  revealNode(id) {
    const root = this.requireRoot(), node = this.nodes.get(String(id));
    if (!node || node.removed || !inside(root.path, node.path)) throw new Error('Choose a file from the current map.');
    const st = fs.lstatSync(node.path);
    if (st.isSymbolicLink() || fs.realpathSync(node.path) !== node.path || st.dev !== node.dev || st.ino !== node.ino) throw new Error('That path changed. Refresh the scan before opening Finder.');
    this.reveal(node.path); return { ok: true };
  }
}
const isStorageRequest = text => require('../menuIntent').menuTopics(text).includes('storage');

const hasLink = (p, root) => require('./plan').hasSymlink(p, fs, root);
const parseStorageTrash = text => !/\b(?:don't|do not|never|without|explain|example|how to)\b/i.test(String(text)) && /\b(?:delete|trash|remove) (?:the |my )?(?:selected files|selection|selected items|files selected|these files)(?: (?:in|from) (?:the )?(?:storage|menu|map))?[.!?]*$/i.test(String(text).trim());
if (!isMainThread && workerData?.root) scanTree(workerData.root, { entireComputer: !!workerData.entireComputer, progress: progress => parentPort.postMessage({ progress }) }).then(result => parentPort.postMessage(result), e => parentPort.postMessage({ error: `Scan unavailable (${e.code || e.message}).` }));
module.exports = { scanTree, StorageScan, isStorageRequest, parseStorageTrash };
