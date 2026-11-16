// Documents, the thinking part: a document is a list of pages, a page is markdown, a paragraph (block) is a stretch of a page between blank lines.
// Nothing here touches the disk or the Mac, so all of it is testable. Page and paragraph numbers are 1-based, because that is how a person says them.

const MAX_PAGES = 40;
const MAX_PAGE_CHARS = 8000;
const MAX_CHANGES = 60;

const clean = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();

// The blocks of one page: split at blank lines, except inside a ``` fence.
function blocks(md) {
  const out = [];
  let cur = [], fence = false;
  for (const line of clean(md).split('\n')) {
    const isFence = /^```/.test(line.trim());
    if (isFence) fence = !fence;
    if (!fence && !isFence && !line.trim()) { if (cur.length) { out.push(cur.join('\n')); cur = []; } continue; }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const join = (list) => list.join('\n\n');

const kindOf = (b) => (/^#{1,4}\s/.test(b) ? 'heading' : /^\s*(?:[-*+]|\d+[.)])\s/.test(b) ? 'list' : /^>/.test(b) ? 'quote' : /^```/.test(b) ? 'code' : 'paragraph');

// A page list the model or the phone sent, checked: an array of non-empty markdown strings.
function cleanPages(pages) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('A document needs at least one page.');
  if (pages.length > MAX_PAGES) throw new Error(`That is too many pages (the limit is ${MAX_PAGES}).`);
  return pages.map((p, i) => {
    const t = clean(typeof p === 'string' ? p : p?.markdown ?? p?.text);
    if (!t) throw new Error(`Page ${i + 1} is empty.`);
    if (t.length > MAX_PAGE_CHARS) throw new Error(`Page ${i + 1} is too long (${t.length} characters; a page holds about 3,000, and ${MAX_PAGE_CHARS} is the limit). Split it into two pages.`);
    return t;
  });
}

const int = (v, what) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number.`); return n; };

function pageAt(pages, v) {
  const n = int(v, 'The page number');
  if (n < 1 || n > pages.length) throw new Error(`There is no page ${n}; the document has ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
  return n - 1;
}

function blockAt(list, v, page) {
  const n = int(v, 'The paragraph number');
  if (n < 1 || n > list.length) throw new Error(`Page ${page} has ${list.length} paragraph${list.length === 1 ? '' : 's'}, so there is no paragraph ${n}.`);
  return n - 1;
}

// Applies edits one after another (a later edit sees the result of the one before) to a copy; throws a sentence for the person when one does not fit.
// { op: 'replace_paragraph', page, paragraph, text } | { op: 'insert_paragraph', page, after, text } (after 0 = at the top) | { op: 'delete_paragraph', page, paragraph }
// | { op: 'replace_page', page, text } | { op: 'add_page', after, text } (after 0 = first) | { op: 'delete_page', page }
function applyOps(pages, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('There was no change to make.');
  if (ops.length > 40) throw new Error('That is too many changes at once.');
  const work = pages.map((p) => blocks(p));
  const text = (o) => { const t = clean(o.text); if (!t) throw new Error('The new text was empty.'); return t; };
  const notes = [];
  for (const o of ops) {
    const op = String(o?.op || '');
    if (op === 'replace_paragraph') { const p = pageAt(work, o.page), b = blockAt(work[p], o.paragraph, p + 1); work[p][b] = text(o); notes.push(`changed paragraph ${b + 1} on page ${p + 1}`); }
    else if (op === 'insert_paragraph') {
      const p = pageAt(work, o.page), after = int(o.after ?? 0, 'The place to insert after');
      if (after < 0 || after > work[p].length) throw new Error(`Page ${p + 1} has ${work[p].length} paragraphs, so I cannot add after ${after}.`);
      work[p].splice(after, 0, text(o)); notes.push(`added a paragraph on page ${p + 1}`);
    } else if (op === 'delete_paragraph') {
      const p = pageAt(work, o.page), b = blockAt(work[p], o.paragraph, p + 1);
      if (work[p].length === 1) throw new Error(`That is the only paragraph on page ${p + 1}. Delete the page instead.`);
      work[p].splice(b, 1); notes.push(`removed paragraph ${b + 1} on page ${p + 1}`);
    } else if (op === 'replace_page') { const p = pageAt(work, o.page); work[p] = blocks(text(o)); notes.push(`rewrote page ${p + 1}`); }
    else if (op === 'add_page') {
      const after = int(o.after ?? work.length, 'The place to add the page after');
      if (after < 0 || after > work.length) throw new Error(`The document has ${work.length} pages, so I cannot add a page after ${after}.`);
      work.splice(after, 0, blocks(text(o))); notes.push(`added a page after page ${after}`);
    } else if (op === 'delete_page') {
      const p = pageAt(work, o.page);
      if (work.length === 1) throw new Error('That is the only page. A document needs at least one.');
      work.splice(p, 1); notes.push(`removed page ${p + 1}`);
    } else throw new Error(`I do not know the change "${op.slice(0, 30)}".`);
  }
  return { pages: cleanPages(work.map(join)), note: notes.length > 3 ? `${notes.slice(0, 3).join(', ')} and ${notes.length - 3} more` : notes.join(', ') };
}

// The pages in a new order. order: the old positions (0-based) in the order they should now be: [2, 0, 1] puts the third page first.
function reorder(pages, order) {
  if (!Array.isArray(order) || order.length !== pages.length) throw new Error('The new order has to name every page once.');
  const seen = new Set();
  for (const v of order) {
    if (!Number.isInteger(v) || v < 0 || v >= pages.length || seen.has(v)) throw new Error('The new order has to name every page once.');
    seen.add(v);
  }
  return order.map((i) => pages[i]);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// What changed between two versions, paragraph by paragraph: [{ type: 'changed'|'added'|'removed', page, before, after }]. page is where it is in the newer one
// (for a removal, where it was in the older one). A paragraph that only moved to another page counts as a removal and an addition.
function changes(oldPages, newPages, units = blocks) {
  const flat = (pages) => pages.flatMap((p, i) => units(p).map((text) => ({ page: i + 1, text })));
  const A = flat(oldPages), B = flat(newPages);
  if (A.length * B.length > 4_000_000) return A.length === B.length && A.every((a, i) => a.text === B[i].text) ? [] : [{ type: 'changed', page: 1, before: '(the whole document)', after: '(the whole document)' }];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].text === B[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, gapA = [], gapB = [];
  const flush = () => {
    const k = Math.min(gapA.length, gapB.length);
    for (let x = 0; x < k; x++) out.push({ type: 'changed', page: gapB[x].page, before: gapA[x].text, after: gapB[x].text });
    for (const a of gapA.slice(k)) out.push({ type: 'removed', page: a.page, before: a.text, after: '' });
    for (const b of gapB.slice(k)) out.push({ type: 'added', page: b.page, before: '', after: b.text });
    gapA = []; gapB = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].text === B[j].text) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) gapB.push(B[j++]);
    else gapA.push(A[i++]);
  }
  flush();
  return out.slice(0, MAX_CHANGES);
}

// A short line for a list on the phone.
const excerpt = (md, n = 110) => { const t = clean(md).replace(/^#{1,4}\s+/gm, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// What the model reads to edit by number: every page with its numbered paragraphs.
function numbered(pages) {
  return pages.map((p, i) => `Page ${i + 1}:\n${blocks(p).map((b, k) => `  [${k + 1}] (${kindOf(b)}) ${b.replace(/\n/g, '\n      ')}`).join('\n')}`).join('\n\n');
}

module.exports = { blocks, cleanPages, applyOps, reorder, changes, excerpt, numbered, kindOf, same, MAX_PAGES, MAX_PAGE_CHARS };
