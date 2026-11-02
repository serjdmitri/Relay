const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DriveAccess } = require('../src/main/drive/access');
function fixture(t, io = fs) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), 'relay-access-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let roots = [];
  const access = new DriveAccess({ home: root, volumes: path.join(root, 'Volumes'), io, store: { get: () => roots, set: (_, v) => { roots = v; } } });
  fs.mkdirSync(path.join(root, 'Volumes'));
  return { root, access };
}
test('chosen folders default to read only, deduplicate, revoke, and never enumerate contents', t => {
  const io = Object.create(fs); let reads = [];
  io.readdirSync = p => { reads.push(p); return fs.readdirSync(p); };
  const { root, access } = fixture(t, io);
  const dir = path.join(root, 'SSD'); fs.mkdirSync(dir);
  const r = access.add(dir).roots[0];
  assert.equal(r.mode, 'read'); assert.equal(r.readable, true);
  assert.throws(() => access.require(r.id, true), /Enable organization/);
  assert.equal(access.add(dir).roots.length, 1);
  access.mode(r.id, 'organize'); assert.equal(access.require(r.id, true).mode, 'organize');
  assert.ok(reads.every(p => p.endsWith('/Volumes')));
  access.remove(r.id); assert.throws(() => access.require(r.id), /Choose/);
});
test('rejects symbolic links, system folders, missing drives and replaced folder identity', t => {
  const { root, access } = fixture(t);
  const dir = path.join(root, 'SSD'); fs.mkdirSync(dir);
  fs.symlinkSync(dir, path.join(root, 'Alias'));
  assert.throws(() => access.add(path.join(root, 'Alias')), /symbolic/);
  assert.throws(() => access.add('/System'));
  const r = access.add(dir).roots[0];
  fs.renameSync(dir, dir + '-old'); fs.mkdirSync(dir);
  assert.match(access.status().roots[0].error, /changed/);
  assert.throws(() => access.require(r.id), /changed/);
  fs.rmdirSync(dir);
  assert.match(access.status().roots[0].error, /Disconnected/);
});
test('denied read and read-only drive errors are visible and block organization', t => {
  const io = Object.create(fs); let denyRead = false;
  io.accessSync = (p, mode) => { if (mode === fs.constants.W_OK || denyRead) { const e = new Error('Denied'); e.code = 'EACCES'; throw e; } return fs.accessSync(p, mode); };
  const { root, access } = fixture(t, io);
  const r = access.add(root).roots[0];
  assert.equal(r.writable, false);
  assert.throws(() => access.mode(r.id, 'organize'), /read-only/);
  denyRead = true;
  assert.match(access.status().roots[0].error, /macOS denied/);
  assert.throws(() => access.require(r.id), /macOS denied/);
});
