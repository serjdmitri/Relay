const test = require('node:test');
const assert = require('node:assert/strict');
const { revealCad } = require('../src/main/models/cadBuild');

test('guided model reveals each shape in order and stops when changed', async () => {
  const cad = { shapes: [{ name: 'base' }, { name: 'wheel' }, { name: 'axle' }] };
  const seen = [];
  const result = await revealCad({ cad, initial: n => `step ${n}`, wait: async () => {},
    show: async (first, text) => { seen.push([first.shapes.length, text]); return 'model'; },
    update: (id, previous, next, text) => { seen.push([next.shapes.length, text]); return next.shapes.length < 3; }
  });
  assert.deepEqual(seen, [[1, 'step 1'], [2, 'step 2'], [3, 'step 3']]);
  assert.deepEqual(result, { id: 'model', completed: false, count: 2 });
});

test('guided model completes and retains all shapes', async () => {
  const cad = { shapes: [{ name: 'base' }, { name: 'wheel' }] };
  let current;
  const result = await revealCad({ cad, initial: n => String(n), wait: async () => {},
    show: async first => { current = first; return 'one'; },
    update: (id, previous, next) => { assert.equal(current, previous); current = next; return true; }
  });
  assert.equal(result.completed, true);
  assert.deepEqual(current.shapes, cad.shapes);
});
