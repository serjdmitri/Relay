// Exercise the Routines buttons in an isolated copy, with fake source data.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-routines-e2e-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'relay.json'), JSON.stringify({ onboardingDone: true, settings: { glass: false, playSounds: false } }));
let app;
try {
  const copy = path.join(tmp, 'Relay-test.app');
  execFileSync('/usr/bin/ditto', ['/Applications/Relay.app', copy]);
  const resources = path.join(copy, 'Contents', 'Resources');
  fs.rmSync(path.join(resources, 'app.asar'), { force: true });
  fs.symlinkSync(root, path.join(resources, 'app'));
  app = await electron.launch({ executablePath: path.join(copy, 'Contents', 'MacOS', 'Relay'), args: [`--user-data-dir=${userData}`, root], env: { ...process.env, RELAY_E2E: '1', RELAY_PAGE: 'routines' }, timeout: 30000 });
  await app.evaluate(async ({ app: electronApp }, desktop) => {
    const end = Date.now() + 15000;
    while (!global.__relay && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
    if (!global.__relay) throw new Error('Relay did not start.');
    electronApp.setPath('desktop', desktop);
    global.__relay.ask.briefingFacts = async () => ({ now: new Date(), due: [{ title: 'Test assignment', overdue: true }], events: [], missing: ['mail'] });
    global.__relay.ask.tomorrowCalendar = async () => ({ events: [], missing: ['Google calendar'] });
  }, tmp);
  await app.evaluate(() => global.__relay.openMain('routines'));
  let main;
  const readyBy = Date.now() + 15000;
  while (!main && Date.now() < readyBy) {
    for (const page of app.windows()) if (await page.locator('#run-daily-plan').count().catch(() => 0)) { main = page; break; }
    if (!main) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!main) throw new Error('Routines page did not render its daily plan button.');
  for (const [button, title] of [['#run-daily-plan', 'Plan today'], ['#run-close-day', 'Close the day']]) {
    await main.click(button);
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const files = fs.existsSync(path.join(tmp, 'memory')) ? fs.readdirSync(path.join(tmp, 'memory')) : [];
      if (files.some(file => fs.readFileSync(path.join(tmp, 'memory', file), 'utf8').includes(`Relay local output: ${title}`))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const files = fs.readdirSync(path.join(tmp, 'memory'));
    assert.ok(files.some(file => fs.readFileSync(path.join(tmp, 'memory', file), 'utf8').includes(`Relay local output: ${title}`)), `${title} saved`);
    await app.evaluate(() => global.__relay.ask.close());
  }
  const before = fs.readdirSync(path.join(tmp, 'memory')).length;
  const scheduled = await app.evaluate(() => global.__relay.ask.runScheduled({ text: 'plan today' }));
  assert.equal(scheduled.status, 'done');
  assert.equal(fs.readdirSync(path.join(tmp, 'memory')).length, before + 1);
  const history = await app.evaluate(() => global.__relay.store.get('history').map(({ text, status }) => ({ text, status })));
  assert.ok(history.some(item => item.text === 'Scheduled: plan today' && item.status === 'done'));
  console.log('Both Routines buttons and a scheduled plan saved isolated reports using fake source data.');
} finally {
  if (app) await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
