const test = require('node:test');
const assert = require('node:assert/strict');
const { guardTools, agentSafe, outsidePaths, pathsIn } = require('../src/main/homeGuard');

const home = '/Users/sergey';

test('paths outside the home folder are found in inputs, shell commands and scripts', () => {
  assert.deepEqual(outsidePaths('open_path', { path: '~/Downloads' }, home), []);
  assert.deepEqual(outsidePaths('open_path', { path: '/Volumes/SD' }, home), ['/Volumes/SD']);
  assert.deepEqual(outsidePaths('list_folder', { path: '/Users/sergey/../other' }, home), ['/Users/sergey/../other'], 'a .. cannot climb out');
  assert.deepEqual(outsidePaths('drive_propose', { moves: [{ from: '~/a.txt', to_folder: '/Volumes/X/a' }], trash: ['/etc/hosts'] }, home), ['/Volumes/X/a', '/etc/hosts']);
  assert.deepEqual(outsidePaths('run_shell', { command: 'ls ~/Documents && cat /etc/hosts > /dev/null' }, home), ['/etc/hosts']);
  assert.deepEqual(outsidePaths('run_shell', { command: '/usr/bin/zip -r "$HOME/a.zip" ~/Desktop && curl https://example.com/x' }, home), []);
  assert.deepEqual(outsidePaths('run_shell', { command: 'cp ${HOME}/a /tmp/b' }, home), [], 'temp space is not a question');
  assert.deepEqual(outsidePaths('run_applescript', { script: 'tell application "Finder" to open POSIX file "/Volumes/Backup"' }, home), ['/Volumes/Backup']);
  assert.deepEqual(outsidePaths('notes_create', { title: 'Plan /Volumes/x', body: 'see /etc' }, home), [], 'only path fields count for other tools');
  assert.deepEqual(pathsIn("echo 'a' | sed 's/a/b/'"), []);
});

test('guarded tools ask, keep their own question, and follow the switch', () => {
  let on = true;
  const base = [
    { name: 'open_path', input_schema: {}, run: () => 'opened' },
    { name: 'trash_path', input_schema: {}, confirm: (i) => `Trash ${i.path}?`, run: () => 'trashed' },
    { name: 'read_file', input_schema: {}, run: () => 'read' },
    { name: 'remember', input_schema: {}, run: () => 'ok' }
  ];
  const [open, trash, read, rem] = guardTools(base, { home, enabled: () => on });
  assert.equal(open.confirm({ path: '~/x' }), null);
  assert.match(open.confirm({ path: '/Volumes/SD' }), /outside your home folder \(\/Volumes\/SD\)/);
  assert.match(trash.confirm({ path: '/Applications/X.app' }), /outside your home folder[\s\S]*Trash \/Applications\/X\.app\?/);
  assert.equal(trash.confirm({ path: '~/x' }), 'Trash ~/x?');
  assert.equal(read.guarded, undefined, 'dropped files were handed over by the user');
  assert.equal(rem.confirm({}), null);
  on = false;
  assert.equal(open.confirm({ path: '/Volumes/SD' }), null, 'switched off');
});

test('background agents cannot ask, so outside paths are refused and tools with their own question stay out', async () => {
  const [open, trash, rem] = guardTools([
    { name: 'open_path', input_schema: {}, run: () => 'opened' },
    { name: 'trash_path', input_schema: {}, confirm: () => 'q', run: () => 'trashed' },
    { name: 'remember', input_schema: {}, run: () => 'ok' }
  ], { home });
  assert.equal(agentSafe(trash), null);
  const a = agentSafe(open);
  assert.equal(a.confirm, undefined);
  assert.equal(a.run({ path: '~/x' }), 'opened');
  assert.match(a.run({ path: '/Volumes/SD' }), /Not done: .*outside the home folder/);
  assert.equal(agentSafe(rem).run({}), 'ok');
});
