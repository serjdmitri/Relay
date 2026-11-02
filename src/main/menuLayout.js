const { screen } = require('electron');
function arrangeMenus(windows) {
  const wins = windows.filter(w => w && !w.isDestroyed() && w.isVisible());
  if (!wins.length) return;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const cols = Math.min(wins.length, Math.max(1, Math.floor(wa.width / 360)));
  const rows = Math.ceil(wins.length / cols), width = Math.min(860, Math.floor((wa.width - 20) / cols)), height = Math.min(720, Math.floor((wa.height - 20) / rows));
  wins.forEach((w, i) => {
    const size = w.getBounds(), min = w.getMinimumSize?.() || [220, 140];
    w.setBounds({ x: wa.x + 10 + i % cols * width, y: wa.y + 10 + Math.floor(i / cols) * height, width: Math.max(min[0], Math.min(size.width, width - 8)), height: Math.max(min[1], Math.min(size.height, height - 8)) });
  });
}
function menusOverlap(windows) {
  const boxes = windows.filter(w => w && !w.isDestroyed() && w.isVisible()).map(w => w.getBounds());
  return boxes.some((a, i) => boxes.slice(i + 1).some(b => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
}
module.exports = { arrangeMenus, menusOverlap };
