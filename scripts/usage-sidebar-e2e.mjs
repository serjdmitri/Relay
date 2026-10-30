// Exercise sidebar layout at the main window's default and minimum heights.
import { launch } from './chromium.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = fs.readFileSync(path.join(root, 'scripts/mock-relay.js'), 'utf8');
const browser = await launch();
try {
  for (const height of [620, 520]) {
    const ctx = await browser.newContext({ viewport: { width: 820, height } });
    await ctx.addInitScript(mock);
    const page = await ctx.newPage();
    await page.goto(`file://${path.join(root, 'src/renderer/index.html')}?page=home`);
    await page.waitForSelector('.usage-menu');
    for (const open of [false, true]) {
      if (open) { await page.locator('.usage-menu summary').nth(0).click(); await page.locator('.usage-menu summary').nth(1).click(); }
      const box = await page.locator('.usage-menu').evaluateAll((items) => items.map((el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
      assert.equal(box.length, 2);
      for (const b of box) assert.ok(b.top >= 0 && b.bottom <= height, `menu outside ${height}px viewport`);
      const nav = page.locator('.sidebar-nav');
      await nav.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const visible = await nav.evaluate((el) => { const account = [...el.querySelectorAll('.nav-item')].find((x) => x.textContent.trim() === 'Account'); const a = account.getBoundingClientRect(); const n = el.getBoundingClientRect(); return a.top >= n.top - 1 && a.bottom <= n.bottom + 1; });
      assert.ok(visible, 'the last navigation item can be reached by scrolling');
    }
    await ctx.close();
  }
  console.log('Usage menus fit and navigation remains reachable at both window sizes.');
} finally { await browser.close(); }
