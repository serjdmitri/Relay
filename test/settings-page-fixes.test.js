// Found by the full audit (frontend review): History > Dictation "Remove" never fired, a suggested routine's name went into the page unescaped,
// a failed Undo left its button stuck on "Undoing…", and esc() did not escape single quotes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Dictation Remove is reachable from the click handler', () => {
  const app = read('src/renderer/app.js');
  const m = app.match(/const drawDict = \(\) => \{[\s\S]*?closest\('([^']+)'\)[\s\S]*?deleteDictation/);
  assert.ok(m, 'found the dictation click handler');
  assert.ok(m[1].split(',').includes('[data-remove]'), `selector: ${m[1]}`);
});

test('a suggested routine name is escaped, and Undo copes with a failure', () => {
  const app = read('src/renderer/app.js');
  assert.match(app, /<span>\$\{esc\(idea\.name\)\}<\/span>/);
  assert.doesNotMatch(app, /const r = await relay\.undoAction\(id\); e\.target\.textContent = r\.ok/);
  assert.equal((app.match(/try \{ r = await relay\.undoAction\(id\); \} catch/g) || []).length, 2);
});

test('esc() escapes all five characters that matter in HTML and attributes', () => {
  const src = read('src/renderer/shared.js');
  const line = src.split('\n').find((l) => l.startsWith('const esc ='));
  const esc = vm.runInNewContext(`${line}\nesc`);
  assert.equal(esc(`<a href='x' title="y">&</a>`), '&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
