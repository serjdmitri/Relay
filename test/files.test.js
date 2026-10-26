const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readDropped, allowed } = require('../src/main/agent/files');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-files-'));
const note = path.join(dir, 'note.txt');
fs.writeFileSync(note, 'Buy milk\nCall mom');
fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3]));
const fake = (out) => async () => out;

test('only dropped files, or what is in a dropped folder, can be read', async () => {
  assert.equal(allowed(note, [note]), true);
  assert.equal(allowed(note, [dir]), true);
  assert.equal(allowed('/etc/hosts', [dir]), false);
  assert.equal(allowed(path.join(dir, '..', 'other'), [dir]), false);
  await assert.rejects(readDropped('/etc/hosts', [dir]), /not given to Relay/);
});

test('text files are read; binary ones are refused politely', async () => {
  assert.deepEqual(await readDropped(note, [note]), { text: 'Buy milk\nCall mom' });
  await assert.rejects(readDropped(path.join(dir, 'blob.bin'), [dir]), /not a text file/);
});

test('a dropped folder lists its contents', async () => {
  const r = await readDropped(dir, [dir]);
  assert.match(r.text, /note\.txt/);
});

test('PDFs and Word files go through the system converters', async () => {
  const pdf = path.join(dir, 'a.pdf');
  fs.writeFileSync(pdf, 'x');
  assert.deepEqual(await readDropped(pdf, [dir], { exec: fake('  page one text  ') }), { text: 'page one text' });
  const docx = path.join(dir, 'b.docx');
  fs.writeFileSync(docx, 'x');
  assert.deepEqual(await readDropped(docx, [dir], { exec: fake('hello') }), { text: 'hello' });
});

test('long text is cut and says so', async () => {
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(big, 'a'.repeat(70000));
  const r = await readDropped(big, [dir]);
  assert.match(r.text, /\[cut: 10000 more characters\]$/);
});
