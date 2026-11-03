const MODES = {
  personal: 'Be a practical personal assistant.',
  homework: 'For schoolwork, explain the reasoning clearly and adapt to the student’s level.',
  coding: 'For coding, prioritize precise technical answers and practical verification.',
  focus: 'Keep responses brief and help the user stay on the current task.'
};
function parseWorkMode(text) {
  const m = String(text || '').trim().match(/^(?:set|switch|change) (?:my )?work mode (?:to )?(personal|homework|coding|focus)[.!?]*$/i);
  return m ? m[1].toLowerCase() : null;
}
function workStyle(mode) { return MODES[mode] || MODES.personal; }
module.exports = { MODES, parseWorkMode, workStyle };

class WorkModeActions{
 constructor({store,openApp,queueRoutine,onChange=()=>{}}){Object.assign(this,{store,openApp,queueRoutine,onChange});this.busy=false;}
 async apply(mode){
  if(!Object.hasOwn(MODES,mode))throw Error('Choose Personal, Homework, Coding or Focus.');if(this.busy)throw Error('A work mode is already opening.');
  const plan=this.store.get('settings.workModePlans')?.[mode]||{},apps=[...new Set(Array.isArray(plan.apps)?plan.apps:[])];
  if(apps.length>8||apps.some(a=>typeof a!=='string'||!a.trim()||a.length>80||! /^[\p{L}\p{N} ._()+&-]+$/u.test(a)))throw Error('Use up to eight application names, not paths or commands.');
  const routine=plan.routineId?(this.store.get('routines')||[]).find(r=>r.id===plan.routineId):null;if(plan.routineId&&!routine)throw Error('That routine no longer exists. Choose another in General settings.');
  this.busy=true;const results=[];
  try{
   const prior=this.store.get('settings.modeNotificationRestore');if(prior!==undefined){if(this.store.get('settings.notify.enabled')===false)this.store.set('settings.notify.enabled',prior);this.store.set('settings.modeNotificationRestore',undefined);}
   this.store.set('settings.workMode',mode);
   if(plan.notifications==='quiet'){this.store.set('settings.modeNotificationRestore',!!this.store.get('settings.notify.enabled'));this.store.set('settings.notify.enabled',false);results.push('Relay phone-completion notifications muted');}
   for(const name of apps){try{await this.openApp(name);results.push('Opened '+name);}catch{results.push('Could not open '+name);}}
   if(routine){this.queueRoutine(routine);results.push('Queued '+routine.name+' with its normal approval checks');}
   this.onChange();return {status:'done',reply:`Work mode set to ${mode}.${results.length?' '+results.join('. ')+'.':''}`};
  }finally{this.busy=false;}
 }
}
module.exports.WorkModeActions=WorkModeActions;
