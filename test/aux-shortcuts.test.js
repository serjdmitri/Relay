const test=require('node:test'),assert=require('node:assert/strict');
const {withAuxiliaryShortcuts}=require('../src/main/hotkeys');
test('gesture pause defaults to Option-H without overwriting user shortcuts',()=>{
 const base={ask:{code:'AltRight',mods:[]}};const s=withAuxiliaryShortcuts(base);
 assert.deepEqual(s.handsPause,{code:'KeyH',mods:['Alt']});assert.equal(base.handsPause,undefined);
 assert.equal(withAuxiliaryShortcuts({...base,type:{code:'KeyH',mods:['Alt']}}).handsPause,undefined);
 const custom={code:'KeyP',mods:['Meta','Shift']};assert.equal(withAuxiliaryShortcuts({...base,handsPause:custom}).handsPause,custom);
});
