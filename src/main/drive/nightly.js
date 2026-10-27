// The nightly Downloads tidy-up: looks at the top level of ~/Downloads and works out where each loose file belongs, by kind. It only PROPOSES (the plan
// is shown and nothing moves until the person says yes), never deletes, and leaves alone anything it is not sure about, anything still downloading and
// anything that arrived in the last few hours. No model is involved. No Electron in here.

const path = require('path');
const { kindOf } = require('./files');

const PARTIAL = /\.(?:crdownload|download|part|partial|tmp|opdownload)$/i;
const DOC = /\.(?:docx?|pages|txt|rtf|md|odt|epub)$/i;

// kind -> the folder (inside the home folder) it goes to. Kinds not listed stay where they are.
const DEST = {
  image: '~/Pictures/Downloaded',
  video: '~/Movies/Downloaded',
  audio: '~/Music/Downloaded',
  pdf: '~/Documents/Downloaded/PDFs',
  document: '~/Documents/Downloaded/Documents',
  spreadsheet: '~/Documents/Downloaded/Spreadsheets',
  slides: '~/Documents/Downloaded/Slides',
  archive: '~/Downloads/Archives and installers',
  code: '~/Documents/Downloaded/Code'
};

// opts: { fs, home, now, minAgeHours = 3, declined: Set of paths the person already skipped, limit = 150 }
// Returns { raw, counts, left } where raw is a plan for buildPlan ({ moves, note }) and left is how many files were left alone.
function planDownloads({ fs, home, now = Date.now(), minAgeHours = 3, declined = new Set(), limit = 150 }) {
  const dir = path.join(home, 'Downloads');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { raw: { moves: [], note: '' }, counts: {}, left: 0 }; }
  const moves = [];
  const counts = {};
  let left = 0;
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue; // folders and hidden files are the person's
    const full = path.join(dir, e.name);
    if (declined.has(full)) { left++; continue; }
    if (PARTIAL.test(e.name)) { left++; continue; }
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (now - st.mtimeMs < minAgeHours * 3600 * 1000) { left++; continue; } // still being written, or just arrived: the person may be using it
    const kind = kindOf(e.name);
    const to = DEST[kind];
    if (!to) { left++; continue; }
    if (moves.length >= limit) { left++; continue; }
    moves.push({ from: full, to_folder: to });
    counts[kind] = (counts[kind] || 0) + 1;
  }
  const bits = Object.entries(counts).map(([k, n]) => `${n} ${k === 'pdf' ? 'PDF' : k}${n === 1 ? '' : 's'}`);
  return { raw: { moves, note: bits.length ? `New downloads by kind: ${bits.join(', ')}` : '' }, counts, left };
}

// Is it time to run tonight's? cfg: { enabled, hour, minute, lastRun: 'YYYY-MM-DD' }. Runs once a day, any time after the set time (a Mac that was
// asleep at nine still gets it when it wakes), but not more than 14 hours late.
function nightlyDue(cfg, now = new Date()) {
  if (!cfg?.enabled) return false;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (cfg.lastRun === day) return false;
  const at = new Date(now);
  at.setHours(cfg.hour ?? 21, cfg.minute ?? 0, 0, 0);
  const late = now - at;
  return late >= 0 && late < 14 * 3600 * 1000;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

module.exports = { planDownloads, nightlyDue, dayKey, DEST };
