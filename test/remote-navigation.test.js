const test=require('node:test'),assert=require('node:assert/strict');
const {NavigationService,point,endpoint,decodeShape}=require('../src/main/remote/navigation');
const a=[-.1278,51.5074],b=[-.1281,51.5080];
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
test('navigation accepts bounded coordinates and provider URLs without credentials',()=>{assert(point(a));for(const p of [[181,1],[1,91],[NaN,0],['0',0],[1,2,3]])assert(!point(p));for(const u of ['file:///a','https://secret@example.com/','https://example.com/?key=secret'])assert.throws(()=>endpoint(u));assert.match(endpoint('http://localhost:2322/api/'),/^http:/);});
test('place search is user-sized, cached, bounded and does not forward authentication',async()=>{const calls=[];const n=new NavigationService({fetchImpl:async(url,opts)=>{calls.push({url,opts});return response({features:[{geometry:{coordinates:a},properties:{name:'Trafalgar Square',city:'London'}},{geometry:{coordinates:[999,0]},properties:{name:'Bad'}}]});}});const result=await n.search('Trafalgar Square');assert.equal(result.length,1);assert.match(result[0].label,/London/);assert.equal((await n.search('Trafalgar Square')).length,1);assert.equal(calls.length,1);assert.equal(calls[0].opts.headers.authorization,undefined);assert.match(calls[0].opts.headers['user-agent'],/RelayNavigation/);await assert.rejects(n.search('Another place'),/wait/);});
test('local/private mode makes no requests, including after a cached search',async()=>{let local=false,calls=0;const n=new NavigationService({isPrivate:()=>local,fetchImpl:async()=>{calls++;return response({features:[]});}});await n.search('London');local=true;await assert.rejects(n.search('London'),/local\/private/);await assert.rejects(n.route(a,b,'walking'),/local\/private/);assert.equal(calls,1);});
test('Valhalla route mode and GeoJSON are checked before returning directions',async()=>{let sent;const n=new NavigationService({fetchImpl:async(url,opts)=>{sent=JSON.parse(opts.body);return response({trip:{summary:{time:120,length:.2},legs:[{shape:{type:'LineString',coordinates:[a,b]},maneuvers:[{instruction:'Head north',length:.2}]}]}});}});const r=await n.route(a,b,'walking');assert.equal(sent.costing,'pedestrian');assert.equal(sent.shape_format,'polyline6');assert.equal(r.seconds,120);assert.equal(r.steps[0].text,'Head north');await assert.rejects(n.route(a,b,'flying'),/valid/);});
test('invalid routes and failed providers are errors, not invented empty results',async()=>{for(const data of [{},{trip:{summary:{time:2,length:1},legs:[{shape:{type:'LineString',coordinates:[a,[999,0]]}}]}}]){const n=new NavigationService({fetchImpl:async()=>response(data)});await assert.rejects(n.route(a,b,'driving'),/usable route|geometry/);}const n=new NavigationService({fetchImpl:async()=>new Response('',{status:503})});await assert.rejects(n.search('London'),/unavailable/);});

test('Valhalla encoded polyline6 is decoded and malformed shapes are bounded',()=>{const points=decodeShape('mlwfaBduxFa@zD[tB]zBDnI}@?w@@mABi@@y@BoBh@iGlBcAXqCiEaEuF');assert.deepEqual(points[0],[-.127843,51.507415]);assert(points.length>2);for(const invalid of ['~','zzzzzzzzzzzz',null])assert.throws(()=>decodeShape(invalid),/geometry/);});

test('route steps carry where each turn begins and what to say, cut to size, and a turn with no usable position is marked so', async () => {
  const a=[-.1278,51.5074],b=[-.1281,51.508],c=[-.1285,51.5085];
  const mk=maneuvers=>new NavigationService({fetchImpl:async()=>response({trip:{summary:{time:60,length:.3},legs:[{shape:{type:'LineString',coordinates:[a,b,c]},maneuvers}]}})});
  const r=await mk([
    {instruction:'Drive north.',length:.1,time:20,begin_shape_index:0,type:2,street_names:['A Road','B Road','C','D'],verbal_pre_transition_instruction:'Drive north on A Road.'},
    {instruction:'Turn left onto Beta.',length:.2,time:40,begin_shape_index:1,type:15,verbal_pre_transition_instruction:'Turn left onto Beta.',verbal_transition_alert_instruction:'Turn left.'},
    {instruction:'Odd step.',length:.0,time:0,begin_shape_index:99,type:'x',street_names:'nope'},
    {instruction:'x'.repeat(900),verbal_pre_transition_instruction:'\u0007bell\n tab'}
  ]).route(a,c,'driving');
  assert.deepEqual(r.steps.map(s=>s.index),[0,1,-1,-1],'an index outside the route is -1');
  assert.deepEqual([r.steps[1].type,r.steps[1].pre,r.steps[1].alert,r.steps[1].seconds,r.steps[1].km],[15,'Turn left onto Beta.','Turn left.',40,.2]);
  assert.deepEqual(r.steps[0].streets,['A Road','B Road','C'],'at most three street names');
  assert.deepEqual([r.steps[2].type,r.steps[2].streets,r.steps[2].pre],[0,[],'']);
  assert.equal(r.steps[3].text.length,500); assert.equal(r.steps[3].pre,'bell tab','control characters are removed');
});
