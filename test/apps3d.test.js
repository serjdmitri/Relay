const test = require('node:test');
const assert = require('node:assert/strict');
const { installedApps, known } = require('../src/main/holo/apps3d');

test('only installed printing and CAD apps are offered, each with the file type it opens best; unknown names are refused', () => {
  const have = new Set(['/Applications/Bambu Studio.app', '/Users/sam/Applications/FreeCAD.app', '/Applications/Safari.app']);
  const found = installedApps((p) => have.has(p), '/Users/sam');
  assert.deepEqual(found.map((a) => [a.name, a.format]), [['Bambu Studio', '3mf'], ['FreeCAD', 'step']]);
  assert.equal(known('bambu studio').format, '3mf');
  assert.equal(known('Terminal'), null, 'an app that is not on the list is never opened');
  assert.equal(known('Autodesk Fusion').format, 'step');
});
