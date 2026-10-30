// Runs an isolated Relay process against the existing read-only Sentient connection.
// No real memories are written; the import folder lives in the temporary directory.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-sentient-e2e-'));
const userData = path.join(tmp, 'userdata');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'relay.json'), JSON.stringify({ onboardingDone: true, settings: { glass: false, playSounds: false, sentient: { enabled: true }, model: { provider: 'claude' } } }));
let app;
try {
  let executablePath;
  try { executablePath = createRequire(import.meta.url)('electron'); }
  catch {
    // Use a disposable copy of the existing installed app as a runtime; never
    // change the installed bundle or its user data.
    const installed = '/Applications/Relay.app';
    if (!fs.existsSync(installed)) throw new Error('No existing Electron runtime was found.');
    const copy = path.join(tmp, 'Relay-test.app');
    execFileSync('/usr/bin/ditto', [installed, copy]);
    const resources = path.join(copy, 'Contents', 'Resources');
    fs.rmSync(path.join(resources, 'app.asar'), { force: true });
    fs.symlinkSync(root, path.join(resources, 'app'));
    executablePath = path.join(copy, 'Contents', 'MacOS', 'Relay');
  }
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`, root], env: { ...process.env, RELAY_E2E: '1', RELAY_PAGE: 'memory' }, timeout: 30000 });
  const result = await app.evaluate(async ({ app: electronApp }, desktop) => {
    const end = Date.now() + 15000;
    while (!global.__relay && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!global.__relay) throw new Error('Relay did not finish starting.');
    const { ask, store } = global.__relay;
    const index = ask.connectorTools().find((tool) => tool.name === 'sentient_index');
    const read = ask.connectorTools().find((tool) => tool.name === 'sentient_read');
    const indexText = await index.run({});
    const noteText = await read.run({ paths: ['README.md'] });
    electronApp.setPath('desktop', desktop);
    const saved = ask.rememberFact('Relay isolated test memory');
    store.set('settings.model.provider', 'ollama');
    const localBlocked = !ask.connectorTools().some((tool) => tool.name.startsWith('sentient_'));
    return { index: indexText.includes('README.md'), note: noteText.length > 100, saved: saved.reply.includes('made a text file'), localBlocked, windows: electronApp.getName() };
  }, tmp);
  assert.deepEqual(result, { index: true, note: true, saved: true, localBlocked: true, windows: 'Relay' });
  const files = fs.readdirSync(path.join(tmp, 'memory'));
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(tmp, 'memory', files[0]), 'utf8'), /Relay isolated test memory/);
  console.log('Isolated Relay read Sentient OS and queued a test memory; local-model guard worked.');
} finally {
  if (app) await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
