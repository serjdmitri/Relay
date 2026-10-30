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
  for (const installed of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await context.addInitScript(mock);
    await context.addInitScript(({ defaults, installed }) => {
      const merge = (base, value) => {
        if (!base || typeof base !== 'object' || Array.isArray(base)) return value === undefined ? base : value;
        const out = { ...base, ...(value || {}) };
        for (const key of Object.keys(base)) out[key] = merge(base[key], value?.[key]);
        return out;
      };
      const decorate = (state) => ({ ...merge(defaults, state), kokoro: { installed } });
      const get = window.relay.getState;
      window.relay.getState = async () => decorate(await get());
      const subscribe = window.relay.onStateChanged;
      window.relay.onStateChanged = (fn) => subscribe((state) => fn(decorate(state)));
      window.relay.set('settings.tts.engine', 'openai');
      window.relay.previewVoice = async () => { window.__voiceAtPreview = await window.relay.getState(); };
    }, { defaults: DEFAULTS, installed });
    const page = await context.newPage();
    await page.goto(`${pathToFileURL(path.join(root, 'src/renderer/index.html'))}?page=speech`);
    await page.locator('#jset').click();
    await page.waitForFunction(() => !!window.__voiceAtPreview);
    const settings = await page.evaluate(() => window.__voiceAtPreview.settings);
    assert.equal(settings.voice, 'jarvis');
    assert.equal(settings.speakReplies, true);
    assert.equal(settings.tts.engine, installed ? 'kokoro' : 'system');
    if (installed) assert.equal(settings.tts.kokoro.voice, 'bm_george');
    await context.close();
  }
  console.log('Jarvis voice setup selects an available free engine before previewing.');
} finally { await browser.close(); }
