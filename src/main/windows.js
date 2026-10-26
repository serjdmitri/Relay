// Moving and sizing windows: halves, quarters, thirds, centred, full. Pure helpers; src/main/agent/mac.js does the moving.

const NAMES = {
  left: 'the left half', right: 'the right half', top: 'the top half', bottom: 'the bottom half',
  'top-left': 'the top left corner', 'top-right': 'the top right corner', 'bottom-left': 'the bottom left corner', 'bottom-right': 'the bottom right corner',
  maximize: 'the whole screen', center: 'the middle',
  'left-third': 'the left third', 'middle-third': 'the middle third', 'right-third': 'the right third'
};

// area: { x, y, w, h } of a display's usable space (below the menu bar, clear of the Dock).
function layoutRect(position, area) {
  const { x, y, w, h } = area;
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const tw = Math.floor(w / 3);
  switch (position) {
    case 'left': return { x, y, w: hw, h };
    case 'right': return { x: x + hw, y, w: w - hw, h };
    case 'top': return { x, y, w, h: hh };
    case 'bottom': return { x, y: y + hh, w, h: h - hh };
    case 'top-left': return { x, y, w: hw, h: hh };
    case 'top-right': return { x: x + hw, y, w: w - hw, h: hh };
    case 'bottom-left': return { x, y: y + hh, w: hw, h: h - hh };
    case 'bottom-right': return { x: x + hw, y: y + hh, w: w - hw, h: h - hh };
    case 'maximize': return { x, y, w, h };
    case 'center': {
      const cw = Math.round(w * 0.62);
      const ch = Math.round(h * 0.74);
      return { x: x + Math.round((w - cw) / 2), y: y + Math.round((h - ch) / 2), w: cw, h: ch };
    }
    case 'left-third': return { x, y, w: tw, h };
    case 'middle-third': return { x: x + tw, y, w: tw, h };
    case 'right-third': return { x: x + 2 * tw, y, w: w - 2 * tw, h };
    default: throw new Error(`Unknown position "${position}". Use ${Object.keys(NAMES).join(', ')}.`);
  }
}

const inside = (r, p) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

// Which display's area to use. displays: [{ bounds, workArea }]. frame: the window's current { x, y, w, h } or null.
// which: 'this' (where the window is), 'other' (the next display), 'main' (the first), or a 1-based number.
function pickArea(displays, frame, which = 'this') {
  if (!displays.length) throw new Error('No display found.');
  const find = () => {
    if (!frame) return 0;
    const c = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    const i = displays.findIndex((d) => inside(d.bounds, c));
    if (i >= 0) return i;
    let best = 0;
    let bestD = Infinity;
    displays.forEach((d, k) => {
      const dx = Math.max(d.bounds.x - c.x, 0, c.x - (d.bounds.x + d.bounds.width));
      const dy = Math.max(d.bounds.y - c.y, 0, c.y - (d.bounds.y + d.bounds.height));
      if (dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; best = k; }
    });
    return best;
  };
  let i = find();
  if (which === 'other') i = (i + 1) % displays.length;
  else if (which === 'main') i = 0;
  else if (/^\d+$/.test(String(which))) i = Math.min(displays.length, Math.max(1, +which)) - 1;
  const a = displays[i].workArea;
  return { x: a.x, y: a.y, w: a.width, h: a.height, index: i };
}

// "snap this window to the left", "put Chrome on the top right", "maximize Safari", "center this window".
// Returns { position, app } (app null = the window in front) or null. text is already normalised.
const POSES = [
  ['top left', 'top-left'], ['upper left', 'top-left'], ['top right', 'top-right'], ['upper right', 'top-right'],
  ['bottom left', 'bottom-left'], ['lower left', 'bottom-left'], ['bottom right', 'bottom-right'], ['lower right', 'bottom-right'],
  ['left third', 'left-third'], ['right third', 'right-third'], ['middle third', 'middle-third'], ['center third', 'middle-third'],
  ['left', 'left'], ['right', 'right'], ['top', 'top'], ['bottom', 'bottom']
];
const SUBJECT_OK = /^(?:[a-z0-9][a-z0-9 .&+-]{0,28})$/;
const THIS = /^(?:this|that|the|my|current|front|frontmost|active)?(?: ?(?:window|app|one))?$/;

function appFrom(raw) {
  const s = String(raw || '').replace(/^(?:the|my) /, '').replace(/ (?:window|app|application)$/, '').trim();
  if (!s || THIS.test(s) || s === 'it' || s === 'window') return null;
  return SUBJECT_OK.test(s) ? s : undefined; // undefined: this is not about a window at all
}

function parseWindowCommand(n) {
  let m;
  if ((m = n.match(/^(?:maximi[sz]e|fill|fullscreen|make (?:this |it |that |the window )?full ?screen)(?: (?:the |this |my )?(.+?))?(?: window)?(?: to (?:the )?(?:whole|full) screen)?$/))) {
    const app = appFrom(m[1]);
    if (app !== undefined && !/^(?:screen|display)$/.test(String(m[1] || ''))) return { position: 'maximize', app };
    if (!m[1] || /^(?:screen|display)$/.test(m[1])) return { position: 'maximize', app: null };
  }
  if ((m = n.match(/^(?:make )?(?:the |this |my )?(.+?) (?:window )?(?:fill|take up|cover) (?:the )?(?:whole |entire |full )?screen$/))) {
    const app = appFrom(m[1]);
    if (app !== undefined) return { position: 'maximize', app };
  }
  if ((m = n.match(/^(?:centre|center)(?: (?:the |this |my )?(.+?))?(?: window)?$/))) {
    const app = appFrom(m[1]);
    if (app !== undefined) return { position: 'center', app };
  }
  const verb = '(?:snap|put|move|send|place|tile|dock|resize|make|set|pin)';
  for (const [phrase, position] of POSES) {
    const tail = `(?:to|on|in|at|into|onto)? ?(?:the )?${phrase}(?: ?(?:half|side|corner|quarter|part))?(?: of (?:the|my) (?:screen|display|monitor))?`;
    if ((m = n.match(new RegExp(`^${verb} (?:the |this |my )?(.*?) ?${tail}$`)))) {
      const app = appFrom(m[1].replace(/ (?:to|on|in|at|into|onto)$/, ''));
      if (app !== undefined) return { position, app };
    }
    if (new RegExp(`^(?:the )?${phrase}(?: ?(?:half|corner|quarter|third))$`).test(n)) return { position, app: null };
  }
  return null;
}

module.exports = { layoutRect, pickArea, parseWindowCommand, NAMES };
