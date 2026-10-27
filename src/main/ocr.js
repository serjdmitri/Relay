// Text from the screen or a screenshot, copied to the clipboard: "copy the text from my last screenshot", "copy the text on my screen",
// "turn this table into a spreadsheet". The reading is done on this Mac (Apple Vision); nothing is sent anywhere. The functions here work on
// the recognised pieces, [{ text, x, y, w, h }] with the box as fractions of the picture (y from the top), so they can be tested.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Returns { type: 'ocr', source: 'screen' | 'screenshot', mode: 'text' | 'table' } or null.
function parseOcrCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  let m;
  const shot = /\b(?:last|latest|recent|newest) screenshot\b|\bscreenshot\b/;
  if ((m = n.match(/^(?:copy|grab|get|extract|pull|read|take)(?: out)?(?: all)?(?: of)? (?:the )?text (?:from|in|on|off|out of) (?:my |the |this )?(?:last |latest |most recent |newest )?(.+)$/))) {
    if (/^screenshot$/.test(m[1])) return { type: 'ocr', source: 'screenshot', mode: 'text' };
    if (/^(?:current |whole |entire )?(?:screen|display|monitor)$/.test(m[1]) || /^what is on (?:my )?screen$/.test(m[1])) return { type: 'ocr', source: 'screen', mode: 'text' };
  }
  if (/^(?:copy|get|grab) what(?:s| is) (?:written )?on (?:my |the )?screen$/.test(n)) return { type: 'ocr', source: 'screen', mode: 'text' };
  if ((m = n.match(/^(?:turn|make|convert|put|copy|export|change)(?: this| that| the| the visible| the first)? table(?: (?:on|in|from) (?:my |the )?(.+?))? (?:into|to|as|in) (?:a |an )?(?:spreadsheet|csv|excel(?: sheet)?|numbers(?: sheet)?|sheet)$/))) {
    return { type: 'ocr', source: m[1] && shot.test(m[1]) ? 'screenshot' : 'screen', mode: 'table' };
  }
  return null;
}

// Pieces in reading order, grouped into lines: pieces whose middles are within half a line height share a line.
function toLines(obs) {
  const items = obs.filter((o) => o && String(o.text).trim()).map((o) => ({ ...o, cy: o.y + o.h / 2 })).sort((a, b) => a.cy - b.cy);
  const lines = [];
  for (const o of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(o.cy - last.cy) <= Math.max(o.h, last.h) * 0.5) { last.items.push(o); last.cy = (last.cy * (last.items.length - 1) + o.cy) / last.items.length; last.h = Math.max(last.h, o.h); }
    else lines.push({ cy: o.cy, h: o.h, items: [o] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x));
}

function plainText(obs) {
  return toLines(obs).map((l) => l.map((o) => o.text.trim()).join(' ')).join('\n');
}

// Cells in columns: the left edges of the pieces are grouped (within 1.5% of the picture's width), and each piece goes to its column.
// Returns { rows: string[][], columns } or null when it does not look like a table (fewer than two columns, or fewer than two rows).
function toTable(obs) {
  const lines = toLines(obs);
  if (lines.length < 2) return null;
  const lefts = lines.flat().map((o) => o.x).sort((a, b) => a - b);
  const cols = [];
  for (const x of lefts) {
    const last = cols[cols.length - 1];
    if (last && x - last.max <= 0.015) { last.max = x; last.sum += x; last.n++; } else cols.push({ min: x, max: x, sum: x, n: 1 });
  }
  // columns used by only one line are noise (a title, a caption)
  const real = cols.filter((c) => c.n >= Math.max(2, Math.ceil(lines.length * 0.4))).map((c) => c.sum / c.n);
  if (real.length < 2) return null;
  const rows = lines.map((l) => {
    const row = Array(real.length).fill('');
    for (const o of l) {
      let best = 0;
      real.forEach((c, i) => { if (Math.abs(c - o.x) < Math.abs(real[best] - o.x)) best = i; });
      row[best] = row[best] ? `${row[best]} ${o.text.trim()}` : o.text.trim();
    }
    return row;
  }).filter((r) => r.some(Boolean));
  return rows.length >= 2 ? { rows, columns: real.length } : null;
}

const toTsv = (rows) => rows.map((r) => r.map((c) => c.replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
const toCsv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');

const path = require('path');
const SHOT = /^(?:Screenshot|Screen Shot|Screen Recording)[^/]*\.(?:png|jpg|jpeg|heic)$/i;
// The newest screenshot file in the first of these folders that has one. dirs: where screenshots are kept (the Mac's setting, then the Desktop).
function latestScreenshot(fs, dirs) {
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    const found = names.filter((n) => SHOT.test(n) && !/Recording/i.test(n)).map((n) => { try { return { file: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t);
    if (found.length) return found[0].file;
  }
  return null;
}

module.exports = { latestScreenshot, parseOcrCommand, toLines, plainText, toTable, toTsv, toCsv };
