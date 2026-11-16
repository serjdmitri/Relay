// Draws one page of a document as a picture, for the phone: a hidden window shows the page on a letter-size sheet and takes a picture of its own contents
// (webContents.capturePage; nothing of the screen is ever captured). The page's HTML is made from escaped markdown and the window cannot load anything
// from the network or run scripts of the page (a content security policy forbids it); only Relay's own measuring script runs.

const { parts } = require('./store');

const W = 816; // a letter sheet is 8.5 x 11 inches: 816 x 1056 CSS pixels
const H = 1056;
const MAX_W = 1224; // pictures wider than this are shrunk (a retina capture is twice the size)

// The sheet for one page: the converter's own style (the same as the Word file's) on white paper with 1 inch margins.
function pageHtml(md) {
  const { style, body } = parts(md);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${style}<style>html,body{margin:0;background:#fff}#sheet{box-sizing:border-box;width:${W}px;min-height:${H}px;padding:96px;overflow-wrap:anywhere}</style></head><body><div id="sheet">${body}</div></body></html>`;
}

// BrowserWindow is passed in (Electron's), so this file loads anywhere. Returns render(markdown) -> { png: Buffer, overflow: boolean }.
// One hidden window is kept for a while and reused for every page (the store draws one page at a time), then closed when it has been idle.
function createPageRenderer({ BrowserWindow, wait = (ms) => new Promise((r) => setTimeout(r, ms)), idleMs = 30000 }) {
  let win = null, idle = null;
  const open = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return win;
  };
  const close = () => { try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* already gone */ } win = null; };
  return async function render(md) {
    clearTimeout(idle);
    const w = open();
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageHtml(md))}`);
      const full = Math.ceil(Number(await w.webContents.executeJavaScript('document.getElementById("sheet").scrollHeight')) || H);
      const height = Math.min(Math.max(full, H), 6000);
      w.setContentSize(W, height);
      await wait(150); // a moment for the window to lay itself out again before the picture
      let img = await w.webContents.capturePage({ x: 0, y: 0, width: W, height });
      if (!img || img.isEmpty()) throw new Error('The page could not be drawn.');
      if (img.getSize().width > MAX_W) img = img.resize({ width: MAX_W });
      return { png: img.toPNG(), overflow: full > H + 2 };
    } catch (e) { close(); throw e; } // a window that failed once is not trusted again
    finally { if (win) { idle = setTimeout(close, idleMs); idle.unref?.(); } }
  };
}

module.exports = { createPageRenderer, pageHtml, W, H };
