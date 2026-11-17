// Draws one page of a document as a picture, for the phone: a hidden window shows the page on a letter-size sheet and takes a picture of its own contents
// (webContents.capturePage; nothing of the screen is ever captured). The page's HTML is made from escaped markdown and the window cannot load anything
// from the network or run scripts of the page (a content security policy forbids it); only Relay's own measuring script runs.

const { parts } = require('./store');
const office = require('./office');

const W = 816; // a letter sheet is 8.5 x 11 inches: 816 x 1056 CSS pixels
const H = 1056;
const MAX_W = 1224; // pictures wider than this are shrunk (a retina capture is twice the size)
// How big a page is drawn, by kind: a letter sheet, a 16:9 slide, and a worksheet (as wide as a sheet, as tall as its rows).
const SIZE = { doc: { w: W, h: H }, slides: { w: 960, h: 540 }, sheet: { w: W, h: 240 } };

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const runsHtml = (text) => office.runs(text).map((r) => (r.b ? `<b>${esc(r.t)}</b>` : r.i ? `<i>${esc(r.t)}</i>` : esc(r.t))).join('');

function slideHtml(md) {
  const s = office.parseSlide(md);
  const body = []; let list = false;
  for (const l of s.body) {
    if (l.bullet && !list) { body.push('<ul>'); list = true; }
    if (!l.bullet && list) { body.push('</ul>'); list = false; }
    body.push(l.bullet ? `<li>${runsHtml(l.text)}</li>` : `<p${l.bold ? ' class="b"' : ''}>${runsHtml(l.text)}</p>`);
  }
  if (list) body.push('</ul>');
  const { w, h } = SIZE.slides;
  return `<!doctype html><html><head><meta charset="utf-8">${CSP}<style>html,body{margin:0;background:#fff}#sheet{box-sizing:border-box;width:${w}px;min-height:${h}px;padding:48px 64px;font:24px/1.35 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;overflow-wrap:anywhere}h1{font-size:40px;margin:0 0 28px;line-height:1.15}ul{margin:0;padding-left:34px}li{margin:0 0 10px}p{margin:0 0 12px}.b{font-weight:700}</style></head><body><div id="sheet">${s.title ? `<h1>${runsHtml(s.title)}</h1>` : ''}${body.join('')}</div></body></html>`;
}

// A worksheet as a grid with column letters and row numbers, like on screen (a formula is shown as typed: the Mac cannot work it out here, Excel and Numbers do when it is opened).
function sheetHtml(md) {
  const s = office.parseSheet(md);
  const cols = Math.max(1, ...s.rows.map((r) => r.length));
  const cell = (v, ri) => { const t = String(v ?? ''); const cls = /^=/.test(t) ? 'f' : /^-?[\d.,]+$/.test(t.trim()) && t.trim() ? 'n' : ''; return `<td class="${cls}${ri === 0 ? ' h' : ''}">${esc(t)}</td>`; };
  const head = `<tr><th></th>${Array.from({ length: cols }, (_, c) => `<th>${office.colName(c)}</th>`).join('')}</tr>`;
  const rows = s.rows.map((r, ri) => `<tr><th>${ri + 1}</th>${Array.from({ length: cols }, (_, c) => cell(r[c], ri)).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${CSP}<style>html,body{margin:0;background:#fff}#sheet{box-sizing:border-box;width:${SIZE.sheet.w}px;min-height:${SIZE.sheet.h}px;padding:16px;font:14px/1.3 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#111}h2{font-size:18px;margin:0 0 10px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d3d8e0;padding:4px 8px;text-align:left;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}th{background:#f1f3f7;color:#667;font-weight:500;text-align:center}td.n{text-align:right}td.h{font-weight:700;background:#fafbfd}td.f{font-style:italic;color:#667}</style></head><body><div id="sheet"><h2>${esc(s.name)}</h2><table>${head}${rows}</table></div></body></html>`;
}

// The sheet for one page. A document page is the converter's own style (the same as the Word file's) on white paper with 1 inch margins.
function pageHtml(md, kind = 'doc') {
  if (kind === 'slides') return slideHtml(md);
  if (kind === 'sheet') return sheetHtml(md);
  const { style, body } = parts(md);
  return `<!doctype html><html><head><meta charset="utf-8">${CSP}${style}<style>html,body{margin:0;background:#fff}#sheet{box-sizing:border-box;width:${W}px;min-height:${H}px;padding:96px;overflow-wrap:anywhere}</style></head><body><div id="sheet">${body}</div></body></html>`;
}

// BrowserWindow is passed in (Electron's), so this file loads anywhere. Returns render(markdown) -> { png: Buffer, overflow: boolean }.
// One hidden window is kept for a while and reused for every page (the store draws one page at a time), then closed when it has been idle.
function createPageRenderer({ BrowserWindow, wait = (ms) => new Promise((r) => setTimeout(r, ms)), idleMs = 30000, timeoutMs = 15000 }) {
  let win = null, idle = null;
  const open = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  };
  const close = () => { try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ } win = null; };
  return async function render(md, kind = 'doc') {
    clearTimeout(idle);
    const w = open();
    const size = SIZE[kind] || SIZE.doc;
    const killer = setTimeout(close, timeoutMs); // a window that hangs is closed, so the next page gets a fresh one (cleared in the finally below, so it is not unref'd)
    try {
      w.setContentSize(size.w, size.h);
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml(md, kind))}`);
      const full = Math.ceil(Number(await w.webContents.executeJavaScript('document.getElementById("sheet").scrollHeight')) || size.h);
      const height = Math.min(Math.max(full, size.h), 6000);
      w.setContentSize(size.w, height);
      await wait(150); // a moment for the window to lay itself out again before the picture
      let img = await w.webContents.capturePage({ x: 0, y: 0, width: size.w, height });
      if (!img || img.isEmpty()) throw new Error('The page could not be drawn.');
      if (img.getSize().width > MAX_W) img = img.resize({ width: MAX_W });
      return { png: img.toPNG(), overflow: kind !== 'sheet' && full > size.h + 2 }; // a sheet is as tall as its rows, so it never "runs past"
    } catch (e) { close(); throw e; } // a window that failed once is not trusted again
    finally { clearTimeout(killer); if (win) { idle = setTimeout(close, idleMs); idle.unref?.(); } }
  };
}

module.exports = { createPageRenderer, pageHtml, SIZE, W, H };
