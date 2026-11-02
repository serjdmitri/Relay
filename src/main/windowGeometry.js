// Persist the final geometry after a drag, without blocking each mouse movement on disk I/O.
function watchGeometry(win, save) {
  let timer;
  const flush = () => { clearTimeout(timer); timer = null; if (!win.isDestroyed()) save(); };
  const queue = () => { clearTimeout(timer); timer = setTimeout(flush, 200); };
  win.on('moved', queue); win.on('resized', queue);
  win.on('close', () => { if (timer) flush(); });
  win.on('closed', () => clearTimeout(timer));
}
module.exports = { watchGeometry };
