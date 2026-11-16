// Spreadsheets and slides as real Office files, made here with no library: an .xlsx and a .pptx are zip files of small XML files, so this builds the XML and
// the store zips it. A spreadsheet page is one worksheet written as text ("## Name" on the first line, then CSV rows); a slide is markdown (a "# heading" is its title,
// the rest is its body, "-" lines are bullets). Nothing here touches the disk or the Mac.

const { blocks } = require('./model');

const KINDS = ['doc', 'sheet', 'slides'];
const EXT = { doc: 'docx', sheet: 'xlsx', slides: 'pptx' };

const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

// ---------------------------------------------------------------- spreadsheets
// One CSV line to its cells: commas separate, "quoted, cells" may hold commas, "" is a quote inside one.
function csvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === '') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const csvCell = (v) => { const s = String(v ?? '').replace(/[\r\n]+/g, ' '); return /[",]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// A worksheet page: { name, rows: [[cell...]...], named }. A first line "## Budget" names it; otherwise it is "Sheet N".
function parseSheet(page, n = 1) {
  const lines = String(page ?? '').replace(/\r\n/g, '\n').split('\n');
  let name = `Sheet ${n}`;
  const m = (lines[0] || '').match(/^##\s+(.*)$/);
  if (m) { name = m[1].trim() || name; lines.shift(); }
  const rows = lines.filter((l) => l.trim() !== '').map(csvLine);
  return { name, rows, named: !!m };
}

function sheetText({ name, rows, named = true }) {
  return `${named ? `## ${name}\n` : ''}${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
}

// "B3" -> { col: 1, row: 2 } (0-based). Throws a sentence for the person.
function parseCell(ref) {
  const m = String(ref || '').trim().toUpperCase().match(/^([A-Z]{1,3})(\d{1,5})$/);
  if (!m) throw new Error(`"${String(ref).slice(0, 12)}" is not a cell like B3.`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

const safeSheetName = (s, used, i) => {
  const base = String(s || '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || `Sheet ${i + 1}`;
  let n = base, k = 1;
  while (used.has(n.toLowerCase())) n = `${base} ${++k}`;
  used.add(n.toLowerCase());
  return n;
};

const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// The files of an .xlsx: path -> text.
function xlsxFiles(pages) {
  const used = new Set();
  const sheets = pages.map((p, i) => { const s = parseSheet(p, i + 1); return { rows: s.rows, name: safeSheetName(s.name, used, i) }; });
  const f = {};
  f['[Content_Types].xml'] = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  f['_rels/.rels'] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  f['xl/workbook.xml'] = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`;
  f['xl/_rels/workbook.xml.rels'] = `${XML}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`;
  // style 0 is plain, style 1 is bold (the header row)
  f['xl/styles.xml'] = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  sheets.forEach((s, i) => {
    const width = Math.max(1, ...s.rows.map((r) => r.length));
    const widths = Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...s.rows.map((r) => String(r[c] ?? '').length + 2))));
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`, st = ri === 0 ? ' s="1"' : '', t = String(v ?? '');
      if (t === '') return '';
      if (/^=.+/.test(t)) return `<c r="${ref}"${st}><f>${esc(t.slice(1))}</f></c>`;
      if (NUM.test(t.trim())) return `<c r="${ref}"${st}><v>${esc(t.trim())}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
    }).join('')}</row>`).join('');
    f[`xl/worksheets/sheet${i + 1}.xml`] = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  return f;
}

// ---------------------------------------------------------------- slides
const EMU = { w: 12192000, h: 6858000 }; // 16:9

// Inline markdown to runs: **bold** and *italic*; anything else is plain text.
function runs(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push(m[1] ? { t: m[1], b: true } : { t: m[2], i: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out.filter((r) => r.t !== '');
}

// A slide's markdown: its title (the first "# heading") and its lines of body: [{ text, bullet, bold }].
function parseSlide(md) {
  const bs = blocks(md);
  let title = '';
  if (bs.length && /^#{1,4}\s/.test(bs[0])) title = bs.shift().replace(/^#{1,4}\s+/, '').trim();
  const body = [];
  for (const b of bs) {
    for (const line of b.split('\n')) {
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (m) body.push({ text: m[1], bullet: true }); else if (line.trim()) body.push({ text: (h ? h[1] : line).trim(), bullet: false, bold: !!h });
    }
  }
  return { title, body };
}

const para = (rs, sz, bold, ppr = '') => `<a:p>${ppr}${rs.map((x) => `<a:r><a:rPr lang="en-US" sz="${sz}"${x.b || bold ? ' b="1"' : ''}${x.i ? ' i="1"' : ''}/><a:t>${esc(x.t)}</a:t></a:r>`).join('') || `<a:endParaRPr lang="en-US" sz="${sz}"/>`}</a:p>`;
const box = (id, name, y, cy, anchor, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="${y}"/><a:ext cx="${EMU.w - 1219200}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const BULLET = '<a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>';
const PLAIN = '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function slideXml(md) {
  const s = parseSlide(md);
  const shapes = [];
  if (s.title) shapes.push(box(2, 'Title', 457200, 1143000, 'b', para(runs(s.title), 4000, true)));
  if (s.body.length) {
    const top = s.title ? 1828800 : 685800;
    shapes.push(box(3, 'Content', top, EMU.h - top - 457200, 't', s.body.map((l) => para(runs(l.text), 2400, !!l.bold, l.bullet ? BULLET : PLAIN)).join('')));
  }
  return `${XML}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Relay"><a:themeElements><a:clrScheme name="Relay"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A37"/></a:dk2><a:lt2><a:srgbClr val="EEF2F6"/></a:lt2><a:accent1><a:srgbClr val="0090B8"/></a:accent1><a:accent2><a:srgbClr val="5B6CFF"/></a:accent2><a:accent3><a:srgbClr val="30B070"/></a:accent3><a:accent4><a:srgbClr val="E0A100"/></a:accent4><a:accent5><a:srgbClr val="D9534F"/></a:accent5><a:accent6><a:srgbClr val="8A5CF6"/></a:accent6><a:hlink><a:srgbClr val="0066CC"/></a:hlink><a:folHlink><a:srgbClr val="6644AA"/></a:folHlink></a:clrScheme><a:fontScheme name="Relay"><a:majorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Relay"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

// The files of a .pptx: path -> text.
function pptxFiles(pages) {
  const f = {};
  f['[Content_Types].xml'] = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`;
  f['_rels/.rels'] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
  f['ppt/presentation.xml'] = `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${EMU.w}" cy="${EMU.h}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  f['ppt/_rels/presentation.xml.rels'] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="theme/theme1.xml"/>${pages.map((_, i) => `<Relationship Id="rId${i + 3}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`;
  f['ppt/slideMasters/slideMaster1.xml'] = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  f['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`;
  f['ppt/slideLayouts/slideLayout1.xml'] = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  f['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
  f['ppt/theme/theme1.xml'] = THEME;
  pages.forEach((md, i) => {
    f[`ppt/slides/slide${i + 1}.xml`] = slideXml(md);
    f[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  return f;
}

module.exports = { KINDS, EXT, csvLine, csvCell, parseSheet, sheetText, parseCell, colName, xlsxFiles, pptxFiles, parseSlide, slideXml, runs, safeSheetName };
