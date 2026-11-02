const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const workArea = { x: 0, y: 0, width: 1440, height: 900 };
class Window {
  constructor() { this.webContents = { send() {} }; this.bounds = { x: 0, y: 0, width: 468, height: 400 }; this.events = {}; }
  isDestroyed() { return !!this.destroyed; } isVisible() { return !this.destroyed; }
  getBounds() { return this.bounds; } setBounds(b) { this.bounds = b; }
  destroy() { this.destroyed = true; } on(name, cb) { this.events[name] = cb; }
}
class CardWindow {
  constructor() { this.win = new Window(); }
  async show(card) { this.card = card; }
  hide() { this.onDismiss?.(this.card); this.card = null; this.win.destroy(); }
  arm() {}
}
Module._load = function(name, ...rest) {
  if (name === 'electron') return { screen: { getDisplayMatching: () => ({ workArea }), getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ workArea }) } };
  if (name === './panel' && rest[0]?.filename.endsWith('/cards/manager.js')) return { CardPanel: CardWindow };
  return original.call(this, name, ...rest);
};
let CardPanel;
try { ({ CardPanel } = require('../src/main/cards/manager')); } finally { Module._load = original; }

test('concurrent menus stay separate; sender actions affect only their menu; pinned cards survive the next request', async () => {
  const m = new CardPanel({});
  // Delegate arrangement to avoid loading Electron outside the mock.
  m.onArrange = () => {};
  const [a,b] = await Promise.all([m.show({ kind: 'weather', location: 'Paris', units: 'c' }), m.show({ kind: 'weather', location: 'London', units: 'f' })]);
  assert.equal(m.live().length, 2);
  assert.equal(m.forSender(a.win.webContents), a);
  assert.deepEqual(await m.action({}, 'pin'), { ok: false });
  await m.action(a.win.webContents, 'pin');
  m.hide();
  assert.equal(m.live().length, 1); assert.equal(a.card.location, 'Paris'); assert.equal(b.card, null);
  m.hide(true); assert.equal(m.live().length, 0);
});

test('refresh keeps the old forecast on failure and changes only requested units on success', async () => {
  const m = new CardPanel({}); const a = await m.show({kind:'weather',location:'Paris',units:'c'});
  m.onRefresh = async () => { throw new Error('offline'); };
  assert.equal((await m.action(a.win.webContents, 'refresh')).ok, false); assert.equal(a.card.units,'c');
  m.onRefresh = async (card, units) => ({location:card.location,units,days:[]});
  assert.equal((await m.action(a.win.webContents, 'units')).ok,true); assert.equal(a.card.units,'f');
});

test('saved geometry is clamped to the connected display and manual changes are saved', async () => {
  let layouts = { '["weather","Paris"]': {x:99999,y:99999,width:600,height:400} };
  const m = new CardPanel({getLayouts:()=>layouts,saveLayouts:value=>{layouts=value}});
  const a = await m.show({kind:'weather',location:'Paris'});
  assert.equal(a.win.bounds.x,840); assert.equal(a.win.bounds.y,500);
  a.win.bounds.x = 100; a.win.events.moved();
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(layouts[a.key].x,100);
});

test('hand targeting finds every held or pinned card, not only the latest one',async()=>{
 const m=new CardPanel({});m.onArrange=()=>{};
 const a=await m.show({kind:'weather',location:'Paris',hold:true}),b=await m.show({kind:'weather',location:'London',hold:true});
 a.win.setBounds({x:0,y:0,width:300,height:300});b.win.setBounds({x:400,y:0,width:300,height:300});
 await m.action(a.win.webContents,'pin');
 assert.equal(m.handTarget({x:100,y:100}).key,a.motionKey);
 assert.equal(m.handTarget({x:500,y:100}).key,b.motionKey);
 m.handTarget({x:100,y:100}).close();assert.equal(m.live().length,1);assert.equal(b.card.location,'London');
});

test('weather choices update only their menu and successful unit toggles save the preference',async()=>{
 const m=new CardPanel({});let saved;
 const a=await m.show({kind:'list',units:'f',choices:[{label:'Paris, France',place:'Paris, France'}]});
 m.onRefresh=async(card,units)=>({location:card.location,units,days:[{date:'2026-11-01',high:20,low:10}]});
 m.onUnitsChange=units=>{saved=units};
 assert.equal((await m.action(a.win.webContents,'choice:9')).ok,false);
 assert.equal((await m.action(a.win.webContents,'choice:0')).ok,true);assert.equal(a.card.kind,'weather');
 assert.equal((await m.action(a.win.webContents,'units')).ok,true);assert.equal(saved,'c');
 m.onRefresh=async()=>{throw Error('offline')};await m.action(a.win.webContents,'units');assert.equal(saved,'c');
});
