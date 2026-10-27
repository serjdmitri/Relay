// The "Hey Siri, Relay" iPhone Shortcut as a file, so it does not have to be built by hand: Dictate Text, send it to Relay on your Mac
// (the key is in the file), then speak the reply. Made as a plain Shortcuts file and signed by the Mac's own `shortcuts sign` so an
// iPhone accepts it (AirDrop it over). The key inside belongs to one paired "phone"; unpair it in Settings > Remote to cancel it.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A small plist (XML) writer: objects, arrays, strings, integers, booleans.
function plist(v, pad = '') {
  if (Array.isArray(v)) return `${pad}<array>\n${v.map((x) => plist(x, pad + '  ')).join('')}${pad}</array>\n`;
  if (typeof v === 'boolean') return `${pad}<${v ? 'true' : 'false'}/>\n`;
  if (typeof v === 'number') return Number.isInteger(v) ? `${pad}<integer>${v}</integer>\n` : `${pad}<real>${v}</real>\n`;
  if (v && typeof v === 'object') return `${pad}<dict>\n${Object.entries(v).map(([k, x]) => `${pad}  <key>${esc(k)}</key>\n${plist(x, pad + '  ')}`).join('')}${pad}</dict>\n`;
  return `${pad}<string>${esc(v)}</string>\n`;
}
const document = (v) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plist(v)}</plist>\n`;

const text = (s) => ({ Value: { string: s }, WFSerializationType: 'WFTextTokenString' });
const fromAction = (uuid, name) => ({ Value: { string: '￼', attachmentsByRange: { '{0, 1}': { OutputName: name, OutputUUID: uuid, Type: 'ActionOutput' } } }, WFSerializationType: 'WFTextTokenString' });
const item = (k, v) => ({ WFItemType: 0, WFKey: text(k), WFValue: v });
const dict = (items) => ({ Value: { WFDictionaryFieldValueItems: items }, WFSerializationType: 'WFDictionaryFieldValue' });

// url: where Relay is (…/api/ask); token: the key, without the word Bearer.
function buildShortcut({ url, token, uuid = () => crypto.randomUUID().toUpperCase() }) {
  const dictate = uuid(), fetchId = uuid(), valueId = uuid();
  return {
    WFWorkflowClientVersion: '2900', WFWorkflowMinimumClientVersion: 900, WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: { WFWorkflowIconStartColor: 431817727, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowImportQuestions: [], WFWorkflowInputContentItemClasses: [], WFWorkflowTypes: ['ActionExtension', 'Watch'],
    WFWorkflowActions: [
      { WFWorkflowActionIdentifier: 'is.workflow.actions.dictatetext', WFWorkflowActionParameters: { UUID: dictate } },
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
        WFWorkflowActionParameters: {
          UUID: fetchId, WFURL: url, WFHTTPMethod: 'POST', WFHTTPBodyType: 'JSON', ShowHeaders: true,
          WFHTTPHeaders: dict([item('Authorization', text(`Bearer ${token}`)), item('X-Relay-Remote', text('1'))]),
          WFJSONValues: dict([item('text', fromAction(dictate, 'Dictated Text')), item('wait', text('true'))])
        }
      },
      { WFWorkflowActionIdentifier: 'is.workflow.actions.getvalueforkey', WFWorkflowActionParameters: { UUID: valueId, WFDictionaryKey: 'reply' } },
      { WFWorkflowActionIdentifier: 'is.workflow.actions.speaktext', WFWorkflowActionParameters: { WFText: fromAction(valueId, 'Dictionary Value') } }
    ]
  };
}

// A Shortcut with one step: open a web address (the Relay page, for the Action Button).
function buildOpenShortcut({ url, uuid = () => crypto.randomUUID().toUpperCase() }) {
  const u = uuid();
  return {
    WFWorkflowClientVersion: '2900', WFWorkflowMinimumClientVersion: 900, WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: { WFWorkflowIconStartColor: 431817727, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowImportQuestions: [], WFWorkflowInputContentItemClasses: [], WFWorkflowTypes: ['ActionExtension', 'Watch'],
    WFWorkflowActions: [
      { WFWorkflowActionIdentifier: 'is.workflow.actions.url', WFWorkflowActionParameters: { UUID: u, WFURLActionURL: url } },
      { WFWorkflowActionIdentifier: 'is.workflow.actions.openurl', WFWorkflowActionParameters: { WFInput: { Value: { OutputName: 'URL', OutputUUID: u, Type: 'ActionOutput' }, WFSerializationType: 'WFTextTokenAttachment' } } }
    ]
  };
}

const run = (args) => new Promise((resolve) => execFile('/usr/bin/shortcuts', args, { timeout: 30000 }, (err, so, se) => resolve({ ok: !err, err: String(se || err?.message || '') })));

// Writes the signed file to outPath. exec is injectable for tests.
async function writeShortcutFile({ url, token, outPath, exec = run, open = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-shortcut-'));
  const raw = path.join(dir, 'Relay.shortcut'); // the signer insists on the .shortcut name
  try {
    fs.writeFileSync(raw, document(open ? buildOpenShortcut({ url }) : buildShortcut({ url, token })), { mode: 0o600 });
    const r = await exec(['sign', '--mode', 'anyone', '--input', raw, '--output', outPath]);
    if (!r.ok) return { ok: false, error: `The Mac could not sign the Shortcut: ${r.err.slice(0, 200)}` };
    return { ok: true, path: outPath };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { buildShortcut, buildOpenShortcut, document, writeShortcutFile };
