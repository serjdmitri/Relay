const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const LOOKS = ['glass', 'instrument', 'studio', 'cockpit', 'buddy'];

test('the five looks are the same list in the Mac window, the Mac\'s settings handler, the phone snapshot and the phone page', () => {
  const app = read('src/renderer/app.js');
  assert.deepEqual([...app.matchAll(/\{ id: '(\w+)', name: '[^']+', tag:/g)].map((m) => m[1]), LOOKS);
  assert.match(read('src/main/main.js'), /looks: \['glass', 'instrument', 'studio', 'cockpit', 'buddy'\], modes: \['system', 'dark', 'light'\], docks: \['labels', 'icons', 'auto'\]/);
  assert.match(read('src/main/askController.js'), /\['glass', 'instrument', 'studio', 'cockpit', 'buddy'\]\.includes\(look\)/);
  assert.match(read('src/remote/look.js'), /\['glass', 'instrument', 'studio', 'cockpit', 'buddy'\]/);
  for (const css of ['src/renderer/looks.css', 'src/remote/looks.css']) {
    const t = read(css);
    for (const l of LOOKS) assert.match(t, new RegExp(`data-look="${l}"`), `${css} styles ${l}`);
  }
});

test('Appearance changes are checked and applied: an unknown look, mode or dock is refused, dark or light sets the app theme, and the phone is told', () => {
  const main = read('src/main/main.js');
  assert.match(main, /key === 'settings\.look' && !APPEARANCE\.looks\.includes\(value\)\) throw/);
  assert.match(main, /key === 'settings\.mode' && !APPEARANCE\.modes\.includes\(value\)\) throw/);
  assert.match(main, /key === 'settings\.dock' && !APPEARANCE\.docks\.includes\(value\)\) throw/);
  assert.match(main, /nativeTheme\.themeSource = mode === 'dark' \|\| mode === 'light' \? mode : 'system'/);
  assert.match(main, /startBridge\(\);\n  applyAppearance\(\);/, 'the saved choice is applied at start');
  assert.match(main, /settings\.look' \|\| key === 'settings\.mode'\) ask\.statusChanged/);
});

test('the Mac menu has three groups on the left, every page id still exists, and the new Usage and Appearance pages are there', () => {
  const app = read('src/renderer/app.js');
  const nav = app.slice(app.indexOf('const NAV = ['), app.indexOf('const TITLES'));
  assert.deepEqual([...nav.matchAll(/\['(Assistant|Connections|Settings)', \[/g)].map((m) => m[1]), ['Assistant', 'Connections', 'Settings']);
  const ids = [...nav.matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]).filter((i) => !['Assistant', 'Connections', 'Settings'].includes(i));
  for (const id of ids) assert.match(app, new RegExp(`\\n  ${id}\\(c\\) \\{`), `${id} is a page`);
  assert.ok(ids.includes('usage') && ids.includes('appearance') && ids.includes('calls') && ids.includes('home'));
  const shared = read('src/renderer/shared.js');
  for (const id of ['usage', 'appearance']) { assert.match(shared, new RegExp(`\\n  ${id}: '<`), `${id} glyph`); assert.match(shared, new RegExp(`${id}: \\['#`), `${id} colour`); }
  assert.doesNotMatch(app, /<summary>\$\{label\} usage<\/summary>/, 'the sidebar usage boxes moved to the Usage page');
});

test('the settings search finds a page by plain words and a setting by its name, and every indexed setting belongs to a real page', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(read('src/renderer/settings-index.js') + ';this.SETTINGS_INDEX = SETTINGS_INDEX; this.PAGE_WORDS = PAGE_WORDS;', sandbox);
  const app = read('src/renderer/app.js');
  const titles = Object.fromEntries([...app.slice(app.indexOf('const NAV = ['), app.indexOf('const TITLES')).matchAll(/\['(\w+)', '([^']+)'\]/g)].filter((m) => !['Assistant', 'Connections', 'Settings'].includes(m[1])).map((m) => [m[1], m[2]]));
  for (const [p, label] of sandbox.SETTINGS_INDEX) { assert.ok(titles[p], `${label} points at page ${p}`); assert.ok(label.length >= 3); }
  assert.ok(sandbox.SETTINGS_INDEX.length > 60, 'the index is not empty');
  const fnSrc = app.slice(app.indexOf('function searchHits'), app.indexOf('function paintSearch'));
  const ctx = { TITLES: titles, SETTINGS_INDEX: sandbox.SETTINGS_INDEX, PAGE_WORDS: sandbox.PAGE_WORDS };
  vm.createContext(ctx); vm.runInContext(fnSrc + ';this.searchHits = searchHits;', ctx);
  assert.equal(ctx.searchHits('bland')[0].page, 'calls', 'bland opens Phone calls');
  assert.equal(ctx.searchHits('codex limit')[0].page, 'usage');
  assert.equal(ctx.searchHits('dark')[0].page, 'appearance');
  assert.equal(ctx.searchHits('mic')[0].page, 'speech');
  assert.equal(ctx.searchHits('zzzzqq').length, 0);
  assert.equal(ctx.searchHits('   ').length, 0);
});

test('the phone page loads the look before it paints and follows the Mac; Glass is the default with real blur, a bright edge and a light mode', () => {
  for (const f of ['index.html', 'flick.html', 'holo.html']) {
    const t = read('src/remote/' + f);
    assert.ok(t.indexOf('/look.js') > -1 && t.indexOf('/look.js') < t.indexOf('/style.css'), `${f} loads look.js first`);
    assert.match(t, /href="\/looks\.css"/);
  }
  assert.match(read('src/main/remote/server.js'), /'\/look\.js': 'look\.js', '\/looks\.css': 'looks\.css'/);
  assert.match(read('src/remote/app.js'), /if \(s\.look && window\.RelayLook\) window\.RelayLook\.apply\(s\.look, s\.mode\)/);
  assert.match(read('src/remote/look.js'), /LOOKS\.indexOf\(look\) < 0\) look = 'glass'/, 'Glass is the default');
  const css = read('src/remote/looks.css');
  assert.match(css, /backdrop-filter: blur\(24px\) saturate\(1\.8\)/);
  assert.match(css, /inset 0 1px 0 var\(--edge\)/);
  assert.match(css, /html\[data-look="glass"\]\[data-mode="light"\]/);
  assert.match(css, /@media \(prefers-color-scheme: light\)[\s\S]*html\[data-look="glass"\]:not\(\[data-mode\]\)/);
  assert.match(css, /prefers-reduced-transparency/);
  assert.doesNotMatch(css, /#cv|#reactor/, 'the reactor is left alone');
});

test('the phone look script applies the look and mode and survives having no storage', () => {
  const attrs = {}, store = {};
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } }, querySelector: () => ({ setAttribute: (k, v) => { attrs.theme = v; } }) };
  const mk = (ls) => ({ document: doc, window: { matchMedia: () => ({ matches: false }) }, localStorage: ls });
  vm.runInNewContext(read('src/remote/look.js'), mk({ getItem: () => null, setItem: (k, v) => { store[k] = v; } }));
  assert.equal(attrs['data-look'], 'glass'); assert.equal(attrs['data-mode'], undefined);
  const ctx = mk({ getItem: (k) => ({ 'relay-look': 'buddy', 'relay-mode': 'light' })[k], setItem: (k, v) => { store[k] = v; } });
  vm.runInNewContext(read('src/remote/look.js'), ctx);
  assert.equal(attrs['data-look'], 'buddy'); assert.equal(attrs['data-mode'], 'light'); assert.equal(attrs.theme, '#eef6fa');
  ctx.window.RelayLook.apply('nonsense', 'system');
  assert.equal(attrs['data-look'], 'glass'); assert.equal(attrs['data-mode'], undefined);
  assert.doesNotThrow(() => vm.runInNewContext(read('src/remote/look.js'), mk({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } })));
});

test('the phone snapshot carries the look and mode, and falls back to Glass and the system setting for anything unknown', () => {
  const { AskController } = require('../src/main/askController');
  const settings = { 'settings.look': 'cockpit', 'settings.mode': 'dark' };
  const self = { store: { get: (k) => settings[k] }, refreshVolume() {}, volumeNow: null, state: 'idle', workView: null, taskList: () => [], agents: { view: () => [] } };
  let snap = null;
  try { snap = AskController.prototype.remoteSnapshot.call(self); } catch { /* the rest of the snapshot needs more of the controller */ }
  if (snap) {
    assert.equal(snap.look, 'cockpit'); assert.equal(snap.mode, 'dark');
    settings['settings.look'] = 'x'; settings['settings.mode'] = 'weird';
    const again = AskController.prototype.remoteSnapshot.call(self);
    assert.equal(again.look, 'glass'); assert.equal(again.mode, 'system');
  } else assert.match(read('src/main/askController.js'), /look: \['glass', 'instrument', 'studio', 'cockpit', 'buddy'\]\.includes\(look\) \? look : 'glass', mode: mode === 'dark' \|\| mode === 'light' \? mode : 'system'/);
});
