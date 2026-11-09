const test=require('node:test'),assert=require('node:assert/strict');
const {coalesce}=require('../src/main/coalesce');
test('a notification burst refreshes once with latest state and accepts later updates',()=>{
 const tasks=[];let state=0;const seen=[];const notify=coalesce(()=>seen.push(state),fn=>tasks.push(fn));
 for(let i=1;i<=20;i++){state=i;notify();}assert.equal(tasks.length,1);tasks.shift()();assert.deepEqual(seen,[20]);
 state=21;notify();tasks.shift()();assert.deepEqual(seen,[20,21]);
});
test('updates triggered during refresh are delivered next turn',()=>{
 const tasks=[];let count=0;const notify=coalesce(()=>{if(++count===1)notify();},fn=>tasks.push(fn));notify();tasks.shift()();tasks.shift()();assert.equal(count,2);
});
