const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { HTML } = require('../src/main/panels/calculator');
const { parsePanelCommand, normalize } = require('../src/main/panels/hub');
test('the calculator opens as an isolated panel and computes using buttons', () => {
  assert.deepEqual(parsePanelCommand('open a calculator'), { type: 'calculator' });
  assert.equal(normalize({ title: 'Calculator', html: HTML }).ok, true);
  const display = { value: '0' }, buttons = [];
  const document = { getElementById: id => id === 'out' ? display : { append: b => buttons.push(b) }, createElement: () => ({}) };
  vm.runInNewContext(HTML.match(/<script>([\s\S]*?)<\/script>/)[1], { document });
  const press = s => buttons.find(b => b.textContent === s).onclick();
  press('7'); press('+'); press('8'); press('=');
  assert.equal(display.value, '15');
  press('C'); press('9'); press('÷'); press('0'); press('=');
  assert.equal(display.value, 'Error');
});
