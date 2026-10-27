const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildShortcut, document, writeShortcutFile } = require('../src/main/remote/shortcutFile');

test('the Shortcut dictates, posts to Relay with the key and waits, reads "reply" and speaks it', () => {
  const ids = ['A', 'B', 'C'];
  const s = buildShortcut({ url: 'https://mac.ts.net/api/ask', token: 'tok123', uuid: () => ids.shift() });
  const [d, f, v, sp] = s.WFWorkflowActions;
  assert.equal(d.WFWorkflowActionIdentifier, 'is.workflow.actions.dictatetext');
  assert.equal(f.WFWorkflowActionParameters.WFURL, 'https://mac.ts.net/api/ask');
  assert.equal(f.WFWorkflowActionParameters.WFHTTPMethod, 'POST');
  const hdr = f.WFWorkflowActionParameters.WFHTTPHeaders.Value.WFDictionaryFieldValueItems.map((i) => [i.WFKey.Value.string, i.WFValue.Value.string]);
  assert.deepEqual(hdr, [['Authorization', 'Bearer tok123'], ['X-Relay-Remote', '1']]);
  const body = f.WFWorkflowActionParameters.WFJSONValues.Value.WFDictionaryFieldValueItems;
  assert.equal(body[0].WFValue.Value.attachmentsByRange['{0, 1}'].OutputUUID, 'A', 'the words are what was dictated');
  assert.equal(body[1].WFValue.Value.string, 'true');
  assert.equal(v.WFWorkflowActionParameters.WFDictionaryKey, 'reply');
  assert.equal(sp.WFWorkflowActionParameters.WFText.Value.attachmentsByRange['{0, 1}'].OutputUUID, 'C');
});

test('the file is a valid property list, and signing is asked of the Mac with the file and where to put the result', async (t) => {
  const s = buildShortcut({ url: 'https://x/api/ask', token: 'k<&>' });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), 'Relay.plist');
  fs.writeFileSync(out, document(s));
  if (process.platform === 'darwin') assert.match(execFileSync('plutil', ['-lint', out]).toString(), /OK/);
  let args = null;
  const r = await writeShortcutFile({ url: 'https://x/api/ask', token: 'k', outPath: '/tmp/out.shortcut', exec: async (a) => { args = a; assert.ok(fs.existsSync(a[a.indexOf('--input') + 1]), 'the file to sign exists while signing'); return { ok: true }; } });
  assert.equal(r.ok, true);
  assert.deepEqual(args.slice(0, 2), ['sign', '--mode']);
  assert.equal(args[args.indexOf('--output') + 1], '/tmp/out.shortcut');
  const bad = await writeShortcutFile({ url: 'u', token: 'k', outPath: '/tmp/o', exec: async () => ({ ok: false, err: 'nope' }) });
  assert.equal(bad.ok, false);
});

test('the open-the-page Shortcut is one URL step then Open URLs on that URL', () => {
  const { buildOpenShortcut } = require('../src/main/remote/shortcutFile');
  const s = buildOpenShortcut({ url: 'https://mac.ts.net/', uuid: () => 'U1' });
  assert.equal(s.WFWorkflowActions.length, 2);
  assert.equal(s.WFWorkflowActions[0].WFWorkflowActionParameters.WFURLActionURL, 'https://mac.ts.net/');
  assert.equal(s.WFWorkflowActions[1].WFWorkflowActionParameters.WFInput.Value.OutputUUID, 'U1');
});
