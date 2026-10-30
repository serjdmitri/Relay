const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportMemory } = require('../src/main/memoryExport');

test('explicit memories create private, dated import files without overwriting', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-memory-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const opts = { now: new Date('2026-10-30T12:00:00Z'), id: 'test-1' };
  const file = exportMemory(dir, 'I prefer a British voice', opts);
  assert.match(fs.readFileSync(file, 'utf8'), /explicitly saved by the user[\s\S]*I prefer a British voice/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => exportMemory(dir, 'another memory', opts), /EEXIST/);
  assert.throws(() => exportMemory(dir, 'my password is secret', { ...opts, id: 'secret' }), /cannot be exported/);
  assert.equal(fs.readdirSync(dir).length, 1);
});
