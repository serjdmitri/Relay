// Voice control of the camera view: "make the camera bigger", "move the camera left", "full screen", "fade the edges more", "hide the boxes", "only show people", "show everything".
// Pure: the text becomes a command, and the window's rectangle becomes its next rectangle. cameraWindow.js applies them.
// Every command needs the word "camera" or "view", so ordinary requests ("make it bigger" in some other app) are never taken.

const strip = (text) => String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
const CAM = '(?:the |my )?(?:camera|webcam|camera view|camera feed|view)';

function parseCameraCommand(text) {
  const n = strip(text); let m;
  if (new RegExp(`^(?:make |get |turn )?${CAM} (?:a (?:bit|little) |much |way )?(?:bigger|larger)$|^(?:enlarge|grow|expand) ${CAM}$|^${CAM} bigger$`).test(n)) return { type: 'camera-adjust', action: 'bigger' };
  if (new RegExp(`^(?:make |get |turn )?${CAM} (?:a (?:bit|little) |much |way )?smaller$|^(?:shrink) ${CAM}$|^${CAM} smaller$`).test(n)) return { type: 'camera-adjust', action: 'smaller' };
  if ((m = new RegExp(`^(?:move|slide|put|shift|drag) ${CAM}(?: over)?(?: to the)? (left|right|up|down|higher|lower)$|^${CAM} (left|right|up|down)$`).exec(n))) {
    const d = m[1] || m[2]; return { type: 'camera-adjust', action: 'move', direction: { higher: 'up', lower: 'down' }[d] || d };
  }
  if (new RegExp(`^(?:make |put |go )?${CAM} (?:full ?screen|fullscreen)$|^(?:full ?screen|fullscreen) ${CAM}$`).test(n)) return { type: 'camera-adjust', action: 'fullscreen' };
  if (new RegExp(`^(?:center|centre|reset|normal|default) ${CAM}(?: size)?$|^${CAM} (?:center|centre|normal size|back to normal)$|^(?:make )?${CAM} normal(?: size)?$`).test(n)) return { type: 'camera-adjust', action: 'reset' };
  if ((m = new RegExp(`^(?:fade|blur|soften) (?:the )?(?:edges|borders) (?:of ${CAM} )?(more|less)$|^${CAM} (?:edges|borders) (?:fade|softer|harder|sharper)(?: (more|less))?$|^(?:fade|soften) ${CAM} (more|less)$`).exec(n))) {
    const w = m[1] || m[2] || m[3] || (/harder|sharper/.test(n) ? 'less' : 'more'); return { type: 'camera-adjust', action: 'fade', amount: w === 'less' ? -1 : 1 };
  }
  if (new RegExp(`^(?:hide|turn off|stop showing|remove|clear) (?:the )?(?:boxes|labels|highlights|outlines|detections)(?: on ${CAM})?$|^(?:stop|no more) (?:highlighting|labelling|labeling)(?: things)?$|^${CAM} (?:boxes|labels) off$`).test(n)) return { type: 'camera-adjust', action: 'boxes', on: false };
  if (new RegExp(`^(?:show|turn on|bring back|add) (?:the )?(?:boxes|labels|highlights|outlines|detections)(?: on ${CAM})?$|^(?:start|keep) (?:highlighting|labelling|labeling)(?: things)?$|^${CAM} (?:boxes|labels) on$`).test(n)) return { type: 'camera-adjust', action: 'boxes', on: true };
  if (new RegExp(`^(?:show|highlight) everything(?: on ${CAM})?$|^(?:show|highlight) all(?: of)? (?:the )?(?:things|objects)$|^(?:clear|remove|reset) (?:the )?(?:filter|highlight filter)$`).test(n)) return { type: 'camera-adjust', action: 'filter', names: [] };
  if ((m = /^(?:only )?(?:show|highlight|box|label|find|track|just show) (?:only |just )?(?:the |any |all |every )?(?:my )?([a-z][a-z ,'-]{1,60}?)(?: in (?:the )?(?:camera|view)| on (?:the )?camera| in front of me| on camera)$|^(?:only|just) (?:show|highlight|box) (?:the |my )?([a-z][a-z ,'-]{1,60})$/.exec(n))) {
    const names = String(m[1] || m[2]).split(/,| and /).map((x) => x.trim().replace(/^(?:the|a|an|my)\s+/, '').replace(/s$/, '').trim()).filter((x) => x && !/^(?:everything|all|things|objects|screen|boxes)$/.test(x)).slice(0, 6);
    if (names.length) return { type: 'camera-adjust', action: 'filter', names };
  }
  return null;
}

// area: the screen's usable rectangle { x, y, width, height }. b: the window now. -> the rectangle it should have. Keeps the window on screen, at least 240 wide, and the picture's 4:3 shape.
function nextBounds(b, area, c) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fit = (x, y, w, h) => { w = clamp(Math.round(w), 240, area.width); h = Math.round(w * 0.75); if (h > area.height) { h = area.height; w = Math.round(h / 0.75); } return { x: clamp(Math.round(x), area.x, area.x + area.width - w), y: clamp(Math.round(y), area.y, area.y + area.height - h), width: w, height: h }; };
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  if (c.action === 'bigger' || c.action === 'smaller') { const f = c.action === 'bigger' ? 1.3 : 1 / 1.3, w = b.width * f; return fit(cx - w / 2, cy - (w * 0.75) / 2, w, w * 0.75); }
  if (c.action === 'move') { const step = Math.round(Math.min(area.width, area.height) * 0.2), dx = { left: -step, right: step }[c.direction] || 0, dy = { up: -step, down: step }[c.direction] || 0; return fit(b.x + dx, b.y + dy, b.width, b.width * 0.75); }
  if (c.action === 'fullscreen') return fit(area.x, area.y, area.width, area.width * 0.75);
  if (c.action === 'reset') { const w = Math.min(640, area.width); return fit(area.x + (area.width - w) / 2, area.y + (area.height - w * 0.75) / 2, w, w * 0.75); }
  return b;
}

module.exports = { parseCameraCommand, nextBounds };
