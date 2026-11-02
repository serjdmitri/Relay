const test=require('node:test'),assert=require('node:assert/strict');
const {FloatingMotion,trashGeometry}=require('../src/main/floatingMotion');
const bounds={x:0,y:0,width:1000,height:800};
function rig(){let time=0,closed=0,finished=0,undo=0;const timers=new Set(),zones=[];let pos={x:100,y:100};const target={key:'item',position:()=>pos,move:(x,y)=>{pos={x,y}},close:()=>closed++,finish:()=>finished++,undo:()=>{undo++}};const m=new FloatingMotion({area:()=>bounds,cursor:()=>pos,now:()=>time,onZone:s=>zones.push(s),onThrow:f=>f(),setTimer:f=>{timers.add(f);return f},clearTimer:f=>timers.delete(f)});return{m,target,zones,timers,get closed(){return closed},get finished(){return finished},get undo(){return undo},get pos(){return pos},time:t=>{time=t}};}
test('trash quarter circle grows near the corner and uses its curved hitbox',()=>{
 assert.equal(trashGeometry({x:100,y:100},bounds).radius,76);
 assert.ok(trashGeometry({x:850,y:700},bounds).radius>150);
 assert.equal(trashGeometry({x:950,y:750},bounds).inside,true);
 assert.equal(trashGeometry({x:790,y:590},bounds).inside,false);
 const left={x:-1200,y:-100,width:1000,height:800};assert.equal(trashGeometry({x:-210,y:690},left).inside,true);
});
test('dropping in trash dismisses only the registered UI target and records undo',()=>{
 const r=rig();r.m.begin(r.target,{x:100,y:100});r.time(100);r.m.update('item',{x:960,y:760});
 assert.equal(r.closed,0,'moving into the target must not dismiss before release');
 r.m.release('item');assert.equal(r.closed,1);assert.equal(r.undo,1);assert.equal(r.timers.size,0);assert.deepEqual(r.zones.at(-1),[]);
});
test('a deliberate flick glides, slows and can dismiss at the right edge',()=>{
 const r=rig();r.m.begin(r.target,{x:600,y:200});r.time(100);r.m.update('item',{x:850,y:200});r.m.release('item');
 assert.equal(r.closed,0);assert.equal(r.timers.size,1);
 for(let i=0;i<140&&r.timers.size;i++)for(const tick of [...r.timers])tick();
 assert.equal(r.closed,1);assert.equal(r.timers.size,0);
});
test('slow release and cancelled hand tracking never throw an item away',()=>{
 const r=rig();r.m.begin(r.target,{x:100,y:100});r.time(100);r.m.update('item',{x:110,y:100});r.m.release('item');assert.equal(r.closed,0);assert.equal(r.finished,1);
 r.m.begin(r.target,{x:950,y:750});r.m.release('item',true);assert.equal(r.closed,0);assert.equal(r.timers.size,0);
});
test('a new grab stops the old glide and multiple held items keep trash visible',()=>{
 const r=rig();r.m.begin(r.target,{x:100,y:100});r.time(100);r.m.update('item',{x:250,y:100});r.m.release('item');assert.equal(r.timers.size,1);
 r.m.begin(r.target,{x:250,y:100});assert.equal(r.timers.size,0);
 r.m.begin({...r.target,key:'other'},{x:400,y:200});r.m.release('item',true);assert.equal(r.zones.at(-1).length,1);r.m.stop();assert.deepEqual(r.zones.at(-1),[]);
});

test('a nearby menu expands the target while releasing a far-away pointer remains safe',()=>{
 const state=trashGeometry({x:650,y:400},bounds,{x:650,y:400,width:350,height:400});
 assert.equal(state.radius,210);assert.equal(state.inside,false);
});

test('a leftward menu flick keeps the title reachable instead of leaving it offscreen',()=>{
 const r=rig();const target={...r.target,position:()=>({...r.pos,width:300,height:200})};
 r.m.begin(target,{x:300,y:150});r.time(100);r.m.update('item',{x:100,y:150});r.m.release('item');
 for(let i=0;i<140&&r.timers.size;i++)for(const tick of [...r.timers])tick();
 assert.equal(r.closed,0);assert.ok(r.pos.x>=0);assert.ok(r.pos.y>=0);
});

test('edge snapping respects usable screen bounds and preserves the size',()=>{
 const {snapRectangle}=require('../src/main/floatingMotion');
 const area={x:-1000,y:40,width:1000,height:720};
 assert.deepEqual(snapRectangle({x:-999,y:43,width:300,height:200},area),{x:-988,y:52});
 assert.deepEqual(snapRectangle({x:-302,y:557,width:300,height:200},area),{x:-312,y:548});
 assert.deepEqual(snapRectangle({x:-600,y:200,width:300,height:200},area),{x:-600,y:200});
 assert.equal(snapRectangle({x:1,y:2},area),null,'hologram centers are not resized or snapped like rectangular menus');
});
