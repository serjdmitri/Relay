const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLayout, findLayout } = require('../src/main/panels/layout');
test('layout commands are explicit and use the newest saved matching name', () => {
  assert.deepEqual(parseLayout('save this layout'), { type: 'save', name: 'My layout' });
  assert.deepEqual(parseLayout('save layout as coding'), { type: 'save', name: 'coding' });
  assert.deepEqual(parseLayout('restore my layout'), { type: 'open', name: 'My layout' });
  assert.equal(parseLayout('open the window'), null);
  assert.equal(findLayout([{ name: 'Coding', savedAt: 2 }, { name: 'coding', savedAt: 1 }], 'CODING').savedAt, 2);
});
