const test=require('node:test'),assert=require('node:assert/strict');
const {editParameter}=require('../src/main/models/scadParameters');
test('changes one standalone value while preserving the rest of the source',()=>{
 const source='// dimension\nwidth = 20; // mm\ncube([width, 3, 4]);\n';
 assert.equal(editParameter(source,'width',24),'// dimension\nwidth = 24; // mm\ncube([width, 3, 4]);\n');
});
test('does not edit comments, expressions, duplicate parameters or non-numeric input',()=>{
 for(const source of ['/*\nwidth = 20;\n*/\n','width = base * 2;\n','width=1;\nwidth=2;\n']) assert.throws(()=>editParameter(source,'width',3));
 assert.throws(()=>editParameter('width=1;\n','width','1; system("x")'));
});
