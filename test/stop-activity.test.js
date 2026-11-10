const test=require('node:test'), assert=require('node:assert/strict');
const {stopActivity}=require('../src/main/stopActivity');
test('stops each supported subsystem even when another fails',()=>{
 const calls=[];const action=name=>()=>calls.push(name);
 const result=stopActivity({ask:{stop:action('request'),agents:{stop:()=>{calls.push('agents');throw Error('broken');}},speaker:{stop:action('speech')},speech:{cancel:action('listening')},cancelAll:action('prompt')},hands:{enabled:true,paused:false,setPaused:()=>calls.push('hands')},motion:{stop:action('motion')},overlay:{releaseInput:action('overlay')}});
 assert.deepEqual(calls,['request','agents','speech','listening','hands','motion','overlay','prompt']);assert.deepEqual(result,{ok:false,failed:['agents']});
});
