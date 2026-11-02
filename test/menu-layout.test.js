const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module'), original = Module._load;
Module._load = function(name, ...args) { return name === 'electron' ? {screen:{getCursorScreenPoint:()=>({}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1440,height:900}})}} : original.call(this,name,...args); };
let arrangeMenus, menusOverlap;
try { ({arrangeMenus,menusOverlap}=require('../src/main/menuLayout')); } finally { Module._load=original; }
const window = (width,height) => ({ bounds:{x:0,y:0,width,height},isVisible:()=>true,isDestroyed:()=>false,getBounds(){return this.bounds},setBounds(b){this.bounds=b},getMinimumSize:()=>[220,140] });
test('arranging menus preserves compact dimensions and separates their visible bounds',()=>{
 const a=window(300,370),b=window(300,370);
 assert.equal(menusOverlap([a,b]),true);
 arrangeMenus([a,b]);
 assert.equal(menusOverlap([a,b]),false);
 assert.equal(a.bounds.width,300);assert.equal(a.bounds.height,370);
 assert.equal(b.bounds.width,300);assert.equal(b.bounds.height,370);
});
test('arrangement shrinks oversized menus to fit instead of enlarging small ones',()=>{
 const a=window(1800,1200);arrangeMenus([a]);
 assert.ok(a.bounds.width<=860);assert.ok(a.bounds.height<=720);
 assert.ok(a.bounds.x+a.bounds.width<=1440);
});
