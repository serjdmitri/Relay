const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { translate, localizeMenu, ES } = require('../src/renderer/ui-es');

test('listed text is translated whole, with its spacing kept; anything else and every other language are left alone', () => {
  assert.equal(translate('Settings…', 'es'), 'Ajustes…');
  assert.equal(translate('  Home\n', 'es'), '  Inicio\n');
  assert.equal(translate('Home', 'en'), 'Home');
  assert.equal(translate('Home', 'fr'), 'Home');
  assert.equal(translate('Something not listed', 'es'), 'Something not listed');
  assert.equal(translate('toString', 'es'), 'toString', 'object keys are not words');
  assert.equal(translate('Stop 2 Background Agents', 'es'), 'Detener 2 agentes en segundo plano');
  assert.equal(translate('Stop 1 Background Agent', 'es'), 'Detener 1 agente en segundo plano');
  assert.equal(translate('Clear 3 Holograms', 'es'), 'Quitar 3 hologramas');
  assert.equal(translate('Ready · ⌥Space to ask', 'es'), 'Listo · ⌥Space para preguntar');
  assert.equal(translate('Last: pause the music', 'es'), 'Última: pause the music');
});

test('the menu bar template is translated including submenus, and the original is not changed', () => {
  const tpl = [{ label: 'Open Relay', click() {} }, { type: 'separator' }, { label: 'Model Speed', submenu: [{ label: 'Fast (Haiku)', type: 'radio' }] }];
  const es = localizeMenu(tpl, 'es');
  assert.deepEqual(es.map((i) => i.label), ['Abrir Relay', undefined, 'Velocidad del modelo']);
  assert.equal(es[2].submenu[0].label, 'Rápido (Haiku)');
  assert.equal(es[0].click, tpl[0].click);
  assert.equal(tpl[0].label, 'Open Relay');
  assert.equal(localizeMenu(tpl, 'en')[0].label, 'Open Relay');
});

test('the words the window really uses are covered: the sidebar, every toggle title, and the menu bar items', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const titles = [...app.matchAll(/toggleRow\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const missing = titles.filter((t) => !(t in ES));
  assert.deepEqual(missing, [], `toggle titles without a Spanish version: ${missing.join(' | ')}`);
  const nav = [...app.slice(app.indexOf('const NAV = ['), app.indexOf('const TITLES')).matchAll(/\['[a-z]+', '([^']+)'\]/g)].map((m) => m[1]);
  assert.deepEqual(nav.filter((t) => !(t in ES)), []);
  const tray = [...main.slice(main.indexOf('function rebuildTray'), main.indexOf('function rebuildTray') + 4500).matchAll(/label: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepEqual(tray.filter((t) => !(t in ES) && !/\$\{/.test(t)), [], 'menu bar items without a Spanish version');
  assert.ok(Object.values(ES).every((v) => typeof v === 'string' && v.length && !/—/.test(v)));
});
