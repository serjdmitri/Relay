import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = fs.readFileSync(path.join(root, 'scripts/mock-relay.js'), 'utf8');
const { DEFAULTS } = createRequire(import.meta.url)('../src/main/store.js');
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.addInitScript(mock);
  await context.addInitScript((defaults) => {
    const merge = (base, value) => {
      if (!base || typeof base !== 'object' || Array.isArray(base)) return value === undefined ? base : value;
      const result = { ...base, ...(value || {}) };
      for (const key of Object.keys(base)) result[key] = merge(base[key], value?.[key]);
      return result;
    };
    const getState = window.relay.getState;
    window.relay.getState = async () => merge(defaults, await getState());
    const onChange = window.relay.onStateChanged;
    window.relay.onStateChanged = (fn) => onChange((value) => fn(merge(defaults, value)));
  }, DEFAULTS);
  const settings = await context.newPage();
  await settings.goto(`${pathToFileURL(path.join(root, 'src/renderer/index.html'))}?page=general`);
  const row = settings.locator('.row').filter({ hasText: 'Assistant visual' });
  await row.getByRole('button', { name: 'Orb' }).click();
  assert.equal(await settings.evaluate(async () => (await window.relay.getState()).settings.assistantVisual), 'orb');
  await row.getByRole('button', { name: 'Reactor' }).click();
  assert.equal(await settings.evaluate(async () => (await window.relay.getState()).settings.assistantVisual), 'reactor');
  const border = settings.locator('.row').filter({ hasText: 'JARVIS screen border' });
  await border.click();
  assert.equal(await settings.evaluate(async () => (await window.relay.getState()).settings.assistantBorder), false);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root, 'src/renderer/overlay.html')).href);
  async function render(visual) {
    await page.evaluate((v) => window.__overlay({ type: 'hud', state: { state: 'done', status: 'done', reply: 'Hello', visual: v } }), visual);
    await page.waitForTimeout(100);
    return page.locator('#hudc').evaluate((canvas) => canvas.toDataURL());
  }
  const reactor = await render('reactor');
  const orb = await render('orb');
  assert.notEqual(orb, reactor, 'orb draws a different assistant');
  assert.equal(await page.locator('#hud').evaluate((el) => el.classList.contains('frame')), true);
  await page.evaluate(() => window.__overlay({ type: 'hud', state: { state: 'done', status: 'done', reply: 'Hello', visual: 'orb', border: false } }));
  assert.equal(await page.locator('#hud').evaluate((el) => el.classList.contains('frame')), false);
  assert.equal(await page.locator('#hudline').textContent(), 'Hello');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Assistant visual setting and both HUD designs work in Chromium.');
} finally { await browser.close(); }
