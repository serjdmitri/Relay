const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/main/documents/model');

const PAGES = ['# Dear team\n\nFirst paragraph.\n\nSecond paragraph.', 'Page two intro.\n\n- one\n- two\n\nPage two end.', 'Last page.'];

test('a page is split into paragraphs at blank lines, and a fenced code block stays whole', () => {
  assert.deepEqual(m.blocks('# T\n\nOne\nstill one\n\nTwo'), ['# T', 'One\nstill one', 'Two']);
  assert.deepEqual(m.blocks('A\n\n```\ncode\n\nmore code\n```\n\nB'), ['A', '```\ncode\n\nmore code\n```', 'B']);
  assert.deepEqual(m.blocks(''), []);
});

test('pages are checked: not empty, not too many, not too long', () => {
  assert.deepEqual(m.cleanPages([' a ', { markdown: 'b' }]), ['a', 'b']);
  assert.throws(() => m.cleanPages([]), /at least one page/);
  assert.throws(() => m.cleanPages(['a', '  ']), /Page 2 is empty/);
  assert.throws(() => m.cleanPages(['x'.repeat(m.MAX_PAGE_CHARS + 1)]), /Page 1 is too long/);
  assert.throws(() => m.cleanPages(Array(m.MAX_PAGES + 1).fill('x')), /too many pages/);
});

test('"change the second paragraph" edits that paragraph only, counted from 1', () => {
  const r = m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 1, paragraph: 3, text: 'Changed.' }]);
  assert.equal(r.pages[0], '# Dear team\n\nFirst paragraph.\n\nChanged.');
  assert.deepEqual(r.pages.slice(1), PAGES.slice(1));
  assert.equal(r.note, 'changed paragraph 3 on page 1');
  assert.equal(PAGES[0], '# Dear team\n\nFirst paragraph.\n\nSecond paragraph.', 'the original is not touched');
});

test('insert, delete, rewrite and page operations', () => {
  assert.equal(m.applyOps(PAGES, [{ op: 'insert_paragraph', page: 3, after: 0, text: 'Top.' }]).pages[2], 'Top.\n\nLast page.');
  assert.equal(m.applyOps(PAGES, [{ op: 'insert_paragraph', page: 3, after: 1, text: 'End.' }]).pages[2], 'Last page.\n\nEnd.');
  assert.equal(m.applyOps(PAGES, [{ op: 'delete_paragraph', page: 1, paragraph: 2 }]).pages[0], '# Dear team\n\nSecond paragraph.');
  assert.equal(m.applyOps(PAGES, [{ op: 'replace_page', page: 3, text: 'New page.' }]).pages[2], 'New page.');
  assert.deepEqual(m.applyOps(PAGES, [{ op: 'add_page', after: 1, text: 'Inserted' }]).pages.map((p) => p.slice(0, 8)), ['# Dear t', 'Inserted', 'Page two', 'Last pag']);
  assert.equal(m.applyOps(PAGES, [{ op: 'add_page', text: 'At the end' }]).pages.at(-1), 'At the end');
  assert.equal(m.applyOps(PAGES, [{ op: 'delete_page', page: 2 }]).pages.length, 2);
});

test('edits that do not fit say so in words', () => {
  assert.throws(() => m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 9, paragraph: 1, text: 'x' }]), /no page 9; the document has 3 pages/);
  assert.throws(() => m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 1, paragraph: 9, text: 'x' }]), /Page 1 has 3 paragraphs, so there is no paragraph 9/);
  assert.throws(() => m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 1, paragraph: 1, text: ' ' }]), /text was empty/);
  assert.throws(() => m.applyOps(PAGES, [{ op: 'delete_paragraph', page: 3, paragraph: 1 }]), /only paragraph/);
  assert.throws(() => m.applyOps(['a'], [{ op: 'delete_page', page: 1 }]), /only page/);
  assert.throws(() => m.applyOps(PAGES, [{ op: 'explode' }]), /do not know the change/);
  assert.throws(() => m.applyOps(PAGES, []), /no change/);
  assert.throws(() => m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 'x', paragraph: 1, text: 'y' }]), /whole number/);
});

test('a later edit in the same request sees the result of the earlier one', () => {
  const r = m.applyOps(PAGES, [{ op: 'delete_paragraph', page: 1, paragraph: 1 }, { op: 'replace_paragraph', page: 1, paragraph: 1, text: 'Now first.' }]);
  assert.equal(r.pages[0], 'Now first.\n\nSecond paragraph.');
});

test('moving pages needs every page named once', () => {
  assert.deepEqual(m.reorder(['a', 'b', 'c'], [2, 0, 1]), ['c', 'a', 'b']);
  for (const bad of [[0, 1], [0, 0, 1], [0, 1, 3], [0, 1, -1], 'x', [0, 1, 1.5]]) assert.throws(() => m.reorder(['a', 'b', 'c'], bad), /every page once/, JSON.stringify(bad));
});

test('what changed: a rewritten paragraph, an added one and a removed one, with the page they are on', () => {
  const next = m.applyOps(PAGES, [{ op: 'replace_paragraph', page: 1, paragraph: 3, text: 'Changed.' }, { op: 'delete_paragraph', page: 2, paragraph: 3 }, { op: 'insert_paragraph', page: 3, after: 1, text: 'Added.' }]).pages;
  assert.deepEqual(m.changes(PAGES, next), [
    { type: 'changed', page: 1, before: 'Second paragraph.', after: 'Changed.' },
    { type: 'removed', page: 2, before: 'Page two end.', after: '' },
    { type: 'added', page: 3, before: '', after: 'Added.' }
  ]);
  assert.deepEqual(m.changes(PAGES, PAGES), []);
});

test('moving whole pages around is not a text change at the paragraph level of a page', () => {
  const moved = m.reorder(PAGES, [1, 0, 2]);
  const c = m.changes(PAGES, moved);
  assert.ok(c.length > 0 && c.every((x) => x.type === 'added' || x.type === 'removed' || x.type === 'changed'));
});

test('numbered text for the model shows every page and paragraph with its number and kind', () => {
  const t = m.numbered(PAGES);
  assert.match(t, /Page 1:\n {2}\[1\] \(heading\) # Dear team\n {2}\[2\] \(paragraph\) First paragraph\./);
  assert.match(t, /Page 2:[\s\S]*\[2\] \(list\) - one\n {6}- two/);
  assert.equal(m.excerpt('# Title\n\nSome **bold** words here', 20), 'Title Some bold wor…');
});
