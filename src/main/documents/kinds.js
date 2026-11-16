// What differs between a Word document, a spreadsheet and a slide deck: how a page is checked, what an edit can say, what counts as one "thing" when showing what
// changed, and what the model reads. A Word page and a slide are markdown (a slide's # heading is its title); a spreadsheet page is one worksheet as text:
// "## Name" on the first line, then CSV rows. Page numbers and row numbers are 1-based, and row 1 of a sheet is the header, as on screen.

const model = require('./model');
const { parseSheet, sheetText, parseCell, csvCell } = require('./office');

const MAX_SHEET_CHARS = 40000;
const MAX_ROWS = 500;
const MAX_COLS = 40;

const UNIT = { doc: 'page', sheet: 'sheet', slides: 'slide' };
const NOUN = { doc: 'Word file', sheet: 'Excel file', slides: 'PowerPoint file' };
const kindOk = (k) => (k === 'sheet' || k === 'slides' ? k : 'doc');

// Pages as the store keeps them: checked. A sheet may be big, so it has its own limits.
function cleanPages(kind, pages) {
  if (kind !== 'sheet') return model.cleanPages(pages);
  if (!Array.isArray(pages) || !pages.length) throw new Error('A spreadsheet needs at least one sheet.');
  if (pages.length > model.MAX_PAGES) throw new Error(`That is too many sheets (the limit is ${model.MAX_PAGES}).`);
  return pages.map((p, i) => {
    const t = String(typeof p === 'string' ? p : p?.text ?? p?.csv ?? '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
    if (!t) throw new Error(`Sheet ${i + 1} is empty.`);
    if (t.length > MAX_SHEET_CHARS) throw new Error(`Sheet ${i + 1} is too big (the limit is ${MAX_SHEET_CHARS} characters).`);
    const s = parseSheet(t, i + 1);
    if (!s.rows.length) throw new Error(`Sheet ${i + 1} has a name but no rows.`);
    if (s.rows.length > MAX_ROWS) throw new Error(`Sheet ${i + 1} has too many rows (the limit is ${MAX_ROWS}).`);
    if (s.rows.some((r) => r.length > MAX_COLS)) throw new Error(`Sheet ${i + 1} has too many columns (the limit is ${MAX_COLS}).`);
    return sheetText(s);
  });
}

// The pieces whose changes are shown: paragraphs for a document or a slide, rows for a sheet (its name line too, so a rename shows).
const units = (kind) => (kind === 'sheet' ? (page) => String(page).split('\n').filter((l) => l.trim()) : model.blocks);
const changes = (kind, a, b) => model.changes(a, b, units(kind));

// What the model reads, to edit by number.
function numbered(kind, pages) {
  if (kind !== 'sheet') return model.numbered(pages);
  return pages.map((p, i) => {
    const s = parseSheet(p, i + 1);
    return `Sheet ${i + 1} "${s.name}" (${s.rows.length} rows):\n${s.rows.map((r, ri) => `  row ${ri + 1}: ${r.join(' | ')}`).join('\n')}`;
  }).join('\n\n');
}

const excerpt = (kind, page) => {
  if (kind !== 'sheet') return model.excerpt(page);
  const s = parseSheet(page);
  return model.excerpt(`${s.name}: ${s.rows.length} row${s.rows.length === 1 ? '' : 's'}, ${s.rows[0]?.join(', ') || ''}`);
};

const int = (v, what) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number.`); return n; };

// The same idea as model.applyOps, for spreadsheets:
// { op: 'set_cell', page, cell: 'B3', text } | { op: 'set_row', page, row, values: [..] } | { op: 'insert_row', page, after, values } (after 0 = at the top) | { op: 'delete_row', page, row }
// | { op: 'rename_sheet', page, name } | { op: 'replace_page', page, text } (CSV) | { op: 'add_page', after, text } (CSV, "## Name" first) | { op: 'delete_page', page }
function applySheetOps(pages, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('There was no change to make.');
  if (ops.length > 60) throw new Error('That is too many changes at once.');
  const work = pages.map((p, i) => parseSheet(p, i + 1));
  const at = (v) => { const n = int(v, 'The sheet number'); if (n < 1 || n > work.length) throw new Error(`There is no sheet ${n}; the spreadsheet has ${work.length}.`); return n - 1; };
  const vals = (o) => { if (!Array.isArray(o.values) || !o.values.length) throw new Error('Give the row as a list of values.'); return o.values.map((v) => String(v ?? '')); };
  const csv = (o) => { const t = String(o.text ?? o.csv ?? '').trim(); if (!t) throw new Error('The new rows were empty.'); const s = parseSheet(t); if (!s.rows.length) throw new Error('The new sheet has no rows.'); return s; };
  const notes = [];
  for (const o of ops) {
    const op = String(o?.op || '');
    if (op === 'set_cell') {
      const p = at(o.page), c = parseCell(o.cell), rows = work[p].rows;
      if (c.row >= MAX_ROWS || c.col >= MAX_COLS) throw new Error(`${String(o.cell).toUpperCase()} is outside what a sheet here can hold.`);
      while (rows.length <= c.row) rows.push(['', '']); // two empty cells, so the row is kept (a blank line is not a row) and the value lands in the row that was named
      while (rows[c.row].length <= c.col) rows[c.row].push('');
      rows[c.row][c.col] = String(o.text ?? '');
      notes.push(`set ${String(o.cell).toUpperCase()} on sheet ${p + 1}`);
    } else if (op === 'set_row') {
      const p = at(o.page), r = int(o.row, 'The row number'), rows = work[p].rows;
      if (r < 1 || r > rows.length) throw new Error(`Sheet ${p + 1} has ${rows.length} rows, so there is no row ${r}.`);
      rows[r - 1] = vals(o); notes.push(`rewrote row ${r} on sheet ${p + 1}`);
    } else if (op === 'insert_row') {
      const p = at(o.page), after = int(o.after ?? work[p].rows.length, 'The row to add after'), rows = work[p].rows;
      if (after < 0 || after > rows.length) throw new Error(`Sheet ${p + 1} has ${rows.length} rows, so I cannot add after row ${after}.`);
      rows.splice(after, 0, vals(o)); notes.push(`added a row on sheet ${p + 1}`);
    } else if (op === 'delete_row') {
      const p = at(o.page), r = int(o.row, 'The row number'), rows = work[p].rows;
      if (r < 1 || r > rows.length) throw new Error(`Sheet ${p + 1} has ${rows.length} rows, so there is no row ${r}.`);
      if (rows.length === 1) throw new Error(`That is the only row on sheet ${p + 1}. Delete the sheet instead.`);
      rows.splice(r - 1, 1); notes.push(`removed row ${r} on sheet ${p + 1}`);
    } else if (op === 'rename_sheet') {
      const p = at(o.page), name = String(o.name ?? '').trim();
      if (!name) throw new Error('The new name was empty.');
      work[p].name = name; work[p].named = true; notes.push(`renamed sheet ${p + 1}`);
    } else if (op === 'replace_page') {
      const p = at(o.page), s = csv(o);
      work[p] = { ...s, name: s.named ? s.name : work[p].name, named: s.named || work[p].named }; notes.push(`rewrote sheet ${p + 1}`);
    } else if (op === 'add_page') {
      const after = int(o.after ?? work.length, 'The place to add the sheet after');
      if (after < 0 || after > work.length) throw new Error(`The spreadsheet has ${work.length} sheets, so I cannot add one after ${after}.`);
      const s = csv(o); work.splice(after, 0, { ...s, named: s.named }); notes.push(`added a sheet after sheet ${after}`);
    } else if (op === 'delete_page') {
      const p = at(o.page);
      if (work.length === 1) throw new Error('That is the only sheet. A spreadsheet needs at least one.');
      work.splice(p, 1); notes.push(`removed sheet ${p + 1}`);
    } else throw new Error(`I do not know the change "${op.slice(0, 30)}".`);
  }
  return { pages: cleanPages('sheet', work.map((s) => sheetText(s))), note: notes.length > 3 ? `${notes.slice(0, 3).join(', ')} and ${notes.length - 3} more` : notes.join(', ') };
}

const applyOps = (kind, pages, ops) => (kind === 'sheet' ? applySheetOps(pages, ops) : model.applyOps(pages, ops));

module.exports = { UNIT, NOUN, kindOk, cleanPages, changes, numbered, excerpt, applyOps, csvCell, MAX_ROWS, MAX_COLS };
