const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLog, verdict } = require('../scripts/startup-check');

test('the log is read for real startup errors, and the usual harmless noise is ignored', () => {
  const bad = classifyLog([
    "(electron) 'safeStorage.isEncryptionAvailable' is deprecated and will be removed. Please use 'safeStorage.isAsyncEncryptionAvailable' instead.",
    '[35461:1102/224850.468800:ERROR:content/browser/network_service_instance_impl.cc:652] Network service crashed or was terminated, restarting service.',
    '[51661:1102/225753:INFO:content/child/child_thread_impl.cc:931] Terminating current process after 15 seconds with no connection.',
    'Firefox bridge: listen EADDRINUSE: address already in use 127.0.0.1:47831',
    "Error occurred in handler for 'firefox:action': [Error: An object could not be cloned.]",
    '(node:12431) UnhandledPromiseRejectionWarning: ReferenceError: fs is not defined',
    '    at /Applications/Relay.app/Contents/Resources/app.asar/src/main/main.js:1567:295',
    'TypeError: Cannot read properties of undefined (reading \'x\')',
    'DevTools listening on ws://127.0.0.1:9333/devtools/browser/abc'
  ].join('\n'));
  assert.equal(bad.errors.length, 2); assert.match(bad.errors[0], /fs is not defined/); assert.match(bad.errors[1], /Cannot read properties of undefined/);
  assert.deepEqual(classifyLog('all quiet\nDevTools listening on ws://x').errors, []); assert.deepEqual(classifyLog('').errors, []);
  assert.equal(classifyLog('Error: Cannot find module \'./missing\'').errors.length, 1);
  assert.equal(classifyLog('x is not defined\nx is not defined').errors.length, 1, 'the same line twice is reported once');
});

test('a healthy start passes: it answered, the window has content, the bridge is there, nothing is in the log', () => {
  const v = verdict({ answered: true, hasPage: true, pageTextLength: 152, apiKeys: 193 });
  assert.deepEqual([v.ok, v.problems, v.warnings], [true, [], []]);
});

test('every way startup can fail is named in plain words, including the blank window and a waiting Keychain prompt', () => {
  const said = (o) => verdict({ answered: true, hasPage: true, pageTextLength: 100, apiKeys: 193, ...o }).problems.join(' | ');
  assert.match(said({ pageTextLength: 0 }), /page is empty \(blank window\)/);
  assert.match(said({ apiKeys: 0 }), /no connection to the app \(only 0 bridge functions/);
  assert.match(said({ hasPage: false }), /created no window page/);
  assert.match(said({ logErrors: ['ReferenceError: fs is not defined'] }), /startup error: ReferenceError: fs is not defined/);
  assert.match(said({ pageErrors: ['Uncaught TypeError: x'] }), /error in the window: Uncaught TypeError/);
  assert.match(said({ exitedEarly: 'exit 1' }), /quit on its own during startup \(exit 1\)/);
  assert.match(verdict({ answered: false, blockedBy: 'Keychain' }).problems[0], /Keychain prompt is open.*Always Allow/);
  assert.match(verdict({ answered: false }).problems[0], /did not finish starting/);
  assert.equal(verdict({ answered: false }).ok, false);
});

test('a different signature is a warning, not a failure, and tells you what will happen', () => {
  const v = verdict({ answered: true, hasPage: true, pageTextLength: 10, apiKeys: 190, designatedDiffers: true });
  assert.equal(v.ok, true); assert.match(v.warnings[0], /signed differently.*Keychain access once.*Always Allow/);
});

test('a locked Mac is recognised, so a build is never judged (or called broken) while the Keychain is out of reach', () => {
  const { screenLocked } = require('../scripts/startup-check');
  assert.equal(screenLocked('<dict>\n\t\t\t<key>CGSSessionScreenIsLocked</key>\n\t\t\t<true/>\n</dict>'), true);
  assert.equal(screenLocked('<key>CGSSessionScreenIsLocked</key><true />'), true);
  assert.equal(screenLocked('<key>CGSSessionScreenIsLocked</key><false/>'), false);
  assert.equal(screenLocked('<key>kCGSSessionOnConsoleKey</key><true/>'), false, 'a different key does not count');
  assert.equal(screenLocked(''), false); assert.equal(screenLocked(undefined), false, 'no reading means not locked (the check then runs as before)');
  const sh = require('node:fs').readFileSync(require('node:path').join(__dirname, '../scripts/make-dmg.sh'), 'utf8');
  assert.match(sh, /--wait-unlock=900/); assert.match(sh, /"\$rc" -eq 3/, 'a locked Mac stops the build with its own message, not a "broken build" one');
});
