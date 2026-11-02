// Folder choices authorize only Relay's file workspace, not other tools or macOS permissions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const inside = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
class DriveAccess {
  constructor({ store, home, io = fs, volumes = '/Volumes' }) { Object.assign(this, { store, home, io, volumes }); }
  roots() { return this.store.get('settings.driveRoots') || []; }
  save(roots) { this.store.set('settings.driveRoots', roots); }
  check(p) {
    const full = path.resolve(p);
    if (this.io.realpathSync(full) !== full) throw new Error('Choose the real folder, not a symbolic link.');
    if (['/', '/Volumes', '/Users'].includes(full) || ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/private', path.join(this.home, 'Library')].some(r => inside(r, full))) throw new Error('Choose a personal folder or a specific external drive.');
    if (full.split(path.sep).some(s => s.startsWith('.') || /\.(app|bundle|framework|photoslibrary|musiclibrary)$/i.test(s))) throw new Error('Hidden folders and application libraries are protected.');
    const st = this.io.lstatSync(full);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Choose a regular folder.');
    return { full, st };
  }
  add(p) {
    const { full, st } = this.check(p);
    this.io.accessSync(full, fs.constants.R_OK);
    const roots = this.roots();
    if (!roots.some(r => r.path === full)) this.save([...roots, { id: crypto.randomUUID(), path: full, dev: st.dev, ino: st.ino, mode: 'read', added: Date.now() }]);
    return this.status();
  }
  probe(root) {
    try {
      const { st } = this.check(root.path);
      if (st.dev !== root.dev || st.ino !== root.ino) throw new Error('Folder or drive changed. Remove it and choose it again.');
      this.io.accessSync(root.path, fs.constants.R_OK);
      let writable = true;
      try { this.io.accessSync(root.path, fs.constants.W_OK); if (this.io.statfsSync && (Number(this.io.statfsSync(root.path).flags || 0) & 1)) writable = false; } catch { writable = false; }
      return { ...root, readable: true, writable, error: '' };
    } catch (e) { return { ...root, readable: false, writable: false, error: e.code === 'ENOENT' ? 'Disconnected or no longer present.' : e.code === 'EACCES' || e.code === 'EPERM' ? 'macOS denied access. Choose the folder again or check Privacy & Security.' : e.message }; }
  }
  require(id, write = false) {
    const root = this.roots().find(r => r.id === id);
    if (!root) throw new Error('Choose a folder first.');
    const checked = this.probe(root);
    if (!checked.readable) throw new Error(checked.error);
    if (write && (root.mode !== 'organize' || !checked.writable)) throw new Error('Enable organization for this folder and check that the drive is writable.');
    return checked;
  }
  mode(id, mode) {
    if (!['read', 'organize'].includes(mode)) throw new Error('Unknown access mode.');
    const root = this.require(id);
    if (mode === 'organize' && !root.writable) throw new Error('This folder is read-only.');
    this.save(this.roots().map(r => r.id === id ? { ...r, mode } : r));
    return this.status();
  }
  remove(id) { this.save(this.roots().filter(r => r.id !== id)); return this.status(); }
  status() {
    let volumes = [], volumeError = '';
    try { volumes = this.io.readdirSync(this.volumes).map(name => ({ name, path: path.join(this.volumes, name) })); }
    catch (e) { volumeError = `Mounted drives could not be listed (${e.code || 'unavailable'}).`; }
    return { roots: this.roots().map(r => this.probe(r)), volumes, volumeError };
  }
}
module.exports = { DriveAccess, inside };
