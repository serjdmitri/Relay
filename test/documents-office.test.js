const test = require('node:test');
const assert = require('node:assert/strict');
const office = require('../src/main/documents/office');
const kinds = require('../src/main/documents/kinds');

const SHEET = '## Budget\nItem,Cost\nRent,1200\nFood,"350.50"\nTotal,=SUM(B2:B3)';

// ---- CSV and sheets ----
test('a CSV line: commas separate, quotes hold commas, doubled quotes are one quote', () => {
  assert.deepEqual(office.csvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(office.csvLine('"a, b",c'), ['a, b', 'c']);
  assert.deepEqual(office.csvLine('Anna,"says ""hi"", twice"'), ['Anna', 'says "hi", twice']);
  assert.deepEqual(office.csvLine('a,,c,'), ['a', '', 'c', '']);
  assert.equal(office.csvCell('a, b'), '"a, b"');
  assert.equal(office.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(office.csvCell('plain'), 'plain');
  assert.equal(office.csvCell('two\nlines'), 'two lines');
});

test('a sheet page has a name line, or is called Sheet N', () => {
  assert.deepEqual(office.parseSheet(SHEET), { name: 'Budget', rows: [['Item', 'Cost'], ['Rent', '1200'], ['Food', '350.50'], ['Total', '=SUM(B2:B3)']], named: true });
  assert.deepEqual(office.parseSheet('a,b\n1,2', 3), { name: 'Sheet 3', rows: [['a', 'b'], ['1', '2']], named: false });
  assert.equal(office.sheetText(office.parseSheet(SHEET)), SHEET.replace('"350.50"', '350.50'));
  assert.equal(office.sheetText({ name: 'X', rows: [['a, b']], named: false }), '"a, b"');
});

test('cells are named like on screen: B3 is column 2, row 3', () => {
  assert.deepEqual(office.parseCell('B3'), { col: 1, row: 2 });
  assert.deepEqual(office.parseCell(' aa10 '), { col: 26, row: 9 });
  assert.equal(office.colName(0), 'A');
  assert.equal(office.colName(25), 'Z');
  assert.equal(office.colName(26), 'AA');
  for (const bad of ['3B', 'B', '', 'B0x', 'ABCD1']) assert.throws(() => office.parseCell(bad), /is not a cell like B3/, bad);
});

// ---- the .xlsx ----
test('an .xlsx has a part for every sheet, typed cells (text, number, formula), a bold header and unique safe names', () => {
  const f = office.xlsxFiles([SHEET, 'Name,Note\nAnna,"a & b <c>"', '## Budget\nx', '## Bad:[name]/x\ny']);
  assert.deepEqual(Object.keys(f).filter((k) => k.startsWith('xl/worksheets/')), ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml']);
  const wb = f['xl/workbook.xml'];
  assert.match(wb, /<sheet name="Budget" sheetId="1" r:id="rId1"\/>/);
  assert.match(wb, /<sheet name="Sheet 2" sheetId="2" r:id="rId2"\/>/);
  assert.match(wb, /<sheet name="Budget 2" sheetId="3"/, 'a repeated name is made different');
  assert.match(wb, /<sheet name="Bad name x" sheetId="4"/, 'characters Excel forbids are taken out');
  assert.match(wb, /<calcPr fullCalcOnLoad="1"\/>/, 'formulas are worked out when it is opened');
  const s1 = f['xl/worksheets/sheet1.xml'];
  assert.match(s1, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Item<\/t><\/is><\/c>/, 'the header is bold');
  assert.match(s1, /<c r="B2"><v>1200<\/v><\/c>/, 'a number is a number');
  assert.match(s1, /<c r="B3"><v>350.50<\/v><\/c>/);
  assert.match(s1, /<c r="B4"><f>SUM\(B2:B3\)<\/f><\/c>/, 'a formula is a formula');
  assert.match(f['xl/worksheets/sheet2.xml'], /a &amp; b &lt;c&gt;/, 'text is escaped');
  assert.equal((f['[Content_Types].xml'].match(/worksheet\+xml/g) || []).length, 4);
  assert.match(f['xl/_rels/workbook.xml.rels'], /Id="rId5"[^>]*styles/);
});

test('control characters never reach the XML', () => {
  assert.ok(!/[\u0000-\u0008]/.test(office.xlsxFiles(['a,b\u0001c\u0008d'])['xl/worksheets/sheet1.xml']));
  assert.ok(!/[\u0000-\u0008]/.test(office.slideXml('# T\u0003itle\n\n- b\u0001ullet')));
});

// ---- the .pptx ----
test('a slide: the first heading is its title, the rest is its body, "-" lines are bullets, bold and italic are kept', () => {
  assert.deepEqual(office.parseSlide('# Quarterly update\n\nGood news and **bold** news\n\n- Revenue up\n- Costs *down*'), { title: 'Quarterly update', body: [{ text: 'Good news and **bold** news', bullet: false, bold: false }, { text: 'Revenue up', bullet: true }, { text: 'Costs *down*', bullet: true }] });
  assert.deepEqual(office.parseSlide('Just words'), { title: '', body: [{ text: 'Just words', bullet: false, bold: false }] });
  assert.deepEqual(office.runs('a **b** and *c*'), [{ t: 'a ' }, { t: 'b', b: true }, { t: ' and ' }, { t: 'c', i: true }]);
});

test('a .pptx has the package parts, one slide part for each slide in order, and a 16:9 size', () => {
  const f = office.pptxFiles(['# One\n\n- a', '# Two', 'Three words']);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/slides/_rels/slide2.xml.rels']) assert.ok(f[p], p);
  const pres = f['ppt/presentation.xml'];
  assert.match(pres, /<p:sldId id="256" r:id="rId3"\/><p:sldId id="257" r:id="rId4"\/><p:sldId id="258" r:id="rId5"\/>/);
  assert.match(pres, /<p:sldSz cx="12192000" cy="6858000"\/>/);
  assert.match(f['ppt/_rels/presentation.xml.rels'], /Id="rId5"[^>]*slides\/slide3\.xml/);
  assert.match(f['ppt/slides/slide1.xml'], /<a:t>One<\/a:t>/);
  assert.match(f['ppt/slides/slide1.xml'], /<a:buChar char="&#8226;"\/>/);
  assert.ok(!f['ppt/slides/slide2.xml'].includes('name="Content"'), 'a slide with only a title has no body box');
  assert.match(f['ppt/slides/slide3.xml'], /name="Content"/);
  assert.equal((f['[Content_Types].xml'].match(/slide\+xml/g) || []).length, 3);
});

// ---- spreadsheet edits ----
const PAGES = kinds.cleanPages('sheet', [SHEET, '## Notes\nName,Note\nAnna,hi']); // pages are always stored this way (the store checks them on the way in)

test('cells, rows and sheets are changed by their on-screen names, counted from 1', () => {
  const set = kinds.applyOps('sheet', PAGES, [{ op: 'set_cell', page: 1, cell: 'B2', text: '900' }]);
  assert.equal(set.pages[0], '## Budget\nItem,Cost\nRent,900\nFood,350.50\nTotal,=SUM(B2:B3)');
  assert.equal(set.note, 'set B2 on sheet 1');
  const far = kinds.applyOps('sheet', PAGES, [{ op: 'set_cell', page: 2, cell: 'C4', text: 'far' }]).pages[1];
  assert.equal(far, '## Notes\nName,Note\nAnna,hi\n,\n,,far', 'a cell past the end grows the sheet');
  assert.equal(office.parseSheet(far).rows[3][2], 'far', 'and it is in the row that was named, row 4');
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'set_row', page: 1, row: 3, values: ['Fuel', '80'] }]).pages[0].split('\n')[3], 'Fuel,80');
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'insert_row', page: 1, after: 3, values: ['Fuel', '80'] }]).pages[0].split('\n')[4], 'Fuel,80');
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'insert_row', page: 1, values: ['Last', '1'] }]).pages[0].split('\n').at(-1), 'Last,1', 'at the end when no place is said');
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'delete_row', page: 1, row: 2 }]).pages[0], '## Budget\nItem,Cost\nFood,350.50\nTotal,=SUM(B2:B3)');
  assert.match(kinds.applyOps('sheet', PAGES, [{ op: 'rename_sheet', page: 2, name: 'People' }]).pages[1], /^## People\n/);
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'add_page', after: 1, text: '## New\na,b\n1,2' }]).pages[1], '## New\na,b\n1,2');
  assert.equal(kinds.applyOps('sheet', PAGES, [{ op: 'delete_page', page: 1 }]).pages.length, 1);
  assert.match(kinds.applyOps('sheet', PAGES, [{ op: 'replace_page', page: 2, text: 'x,y\n1,2' }]).pages[1], /^## Notes\nx,y\n1,2$/, 'the sheet keeps its name');
});

test('spreadsheet edits that do not fit say so in words', () => {
  const bad = (ops, re) => assert.throws(() => kinds.applyOps('sheet', PAGES, ops), re);
  bad([{ op: 'set_cell', page: 9, cell: 'A1', text: 'x' }], /no sheet 9; the spreadsheet has 2/);
  bad([{ op: 'set_cell', page: 1, cell: 'nope', text: 'x' }], /not a cell like B3/);
  bad([{ op: 'set_cell', page: 1, cell: 'A9999', text: 'x' }], /outside what a sheet here can hold/);
  bad([{ op: 'set_row', page: 1, row: 9, values: ['x'] }], /has 4 rows, so there is no row 9/);
  bad([{ op: 'set_row', page: 1, row: 1 }], /list of values/);
  bad([{ op: 'delete_row', page: 2, row: 1 }, { op: 'delete_row', page: 2, row: 1 }], /only row/);
  bad([{ op: 'rename_sheet', page: 1, name: ' ' }], /name was empty/);
  bad([{ op: 'delete_page', page: 1 }, { op: 'delete_page', page: 1 }], /only sheet/);
  bad([{ op: 'add_page', text: '## Only a name' }], /no rows/);
  bad([{ op: 'explode' }], /do not know the change/);
  bad([], /no change/);
});

test('sheets are checked: not empty, not too big, not too many columns', () => {
  assert.deepEqual(kinds.cleanPages('sheet', ['## A\nx,y\n1,2']), ['## A\nx,y\n1,2']);
  assert.throws(() => kinds.cleanPages('sheet', []), /at least one sheet/);
  assert.throws(() => kinds.cleanPages('sheet', [' ']), /Sheet 1 is empty/);
  assert.throws(() => kinds.cleanPages('sheet', ['## Name only']), /no rows/);
  assert.throws(() => kinds.cleanPages('sheet', [Array(kinds.MAX_ROWS + 1).fill('a').join('\n')]), /too many rows/);
  assert.throws(() => kinds.cleanPages('sheet', [Array(kinds.MAX_COLS + 1).fill('a').join(',')]), /too many columns/);
  assert.throws(() => kinds.cleanPages('sheet', ['x'.repeat(50000)]), /too big/);
  assert.deepEqual(kinds.cleanPages('slides', ['# A']), ['# A'], 'slides are checked like pages');
});

test('the model reads a sheet by row number, and a change shows the row, not a paragraph', () => {
  assert.equal(kinds.numbered('sheet', PAGES), 'Sheet 1 "Budget" (4 rows):\n  row 1: Item | Cost\n  row 2: Rent | 1200\n  row 3: Food | 350.50\n  row 4: Total | =SUM(B2:B3)\n\nSheet 2 "Notes" (2 rows):\n  row 1: Name | Note\n  row 2: Anna | hi');
  const next = kinds.applyOps('sheet', PAGES, [{ op: 'set_cell', page: 1, cell: 'B2', text: '900' }, { op: 'delete_row', page: 2, row: 2 }]).pages;
  assert.deepEqual(kinds.changes('sheet', PAGES, next), [
    { type: 'changed', page: 1, before: 'Rent,1200', after: 'Rent,900' },
    { type: 'removed', page: 2, before: 'Anna,hi', after: '' }
  ]);
  assert.deepEqual(kinds.changes('sheet', PAGES, PAGES), []);
  assert.equal(kinds.excerpt('sheet', SHEET), 'Budget: 4 rows, Item, Cost');
});

test('slides are edited like pages: by paragraph, and a slide is a page for moving', () => {
  const slides = ['# Title\n\n- one\n\n- two', '# Next'];
  assert.equal(kinds.applyOps('slides', slides, [{ op: 'replace_paragraph', page: 1, paragraph: 2, text: '- uno' }]).pages[0], '# Title\n\n- uno\n\n- two');
  assert.equal(kinds.UNIT.slides, 'slide');
  assert.equal(kinds.kindOk('anything'), 'doc');
  assert.equal(kinds.kindOk('sheet'), 'sheet');
});
