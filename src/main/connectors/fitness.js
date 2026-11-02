const {SERVICES}=require('./googleSetup');
const METRICS=[['steps','Steps','steps','countSum','steps'],['heart-rate','Average heart rate','heartRate','beatsPerMinuteAvg','bpm'],['total-calories','Total calories','totalCalories','kcalSum','kcal']];
function fitnessIntent(text){return /\b(?:fitbit|fitness (?:stats|menu|dashboard)|(?:my|today.?s) (?:step count|steps|heart rate)|steps today|how many steps)\b/i.test(String(text));}
function dayKey(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function rangeFor(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Choose a valid date.');
 const end=new Date(day+'T00:00:00Z');if(!Number.isFinite(+end)||end.toISOString().slice(0,10)!==day)throw Error('Choose a valid date.');
 const civil=d=>({date:{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()},time:{}});
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-6);end.setUTCDate(end.getUTCDate()+1);
 return {start:civil(start),end:civil(end)};
}
function pointsFor(json,field,value){return (Array.isArray(json.rollupDataPoints)?json.rollupDataPoints:[]).slice(0,90).flatMap(p=>{
 const d=p.civilStartTime?.date,v=p[field]?.[value];if(!d||v===undefined||v===null||v===''||!Number.isFinite(Number(v))||Number(v)<0)return[];
 return [{date:`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`,value:Number(v)}];
}).sort((a,b)=>a.date.localeCompare(b.date));}
class FitnessStats{
 constructor({store,getApi,fetchImpl=fetch,now=()=>Date.now()}){Object.assign(this,{store,getApi,fetch:fetchImpl,now});this.pending=null;}
 accounts(){return (this.store.get('settings.connectors.google.accounts')||[]).filter(a=>SERVICES.fitness.scopes.every(s=>a.scopes?.includes(s)));}
 cancel(){this.pending?.abort();}
 async snapshot({email,day=dayKey()}={}){
  if(this.store.get('settings.model.provider')==='ollama'){this.cancel();return{error:'Fitbit uses Google’s cloud and is disabled in local/private mode.',accounts:[]};}
  const accounts=this.accounts().map(a=>a.email),result={accounts,day,goal:this.store.get('settings.fitnessStepGoal')||10000};
  if(!accounts.length)return{...result,error:'In Connections, select Fitbit / Google Health, then Connect with Google. Enable Google Health API in your Google Cloud project first.'};
  if(!email&&accounts.length===1)email=accounts[0];
  if(!accounts.includes(email))return{...result,error:'Choose the Google account linked to your Fitbit.'};
  const range=rangeFor(day),api=this.getApi();if(!api)return{...result,error:'Reconnect Google in Connections.'};
  this.cancel();const ac=this.pending=new AbortController(),saved=this.accounts().find(a=>a.email===email),client=this.store.get('settings.connectors.google.clientId');
  const current=()=>!ac.signal.aborted&&this.store.get('settings.model.provider')!=='ollama'&&this.store.get('settings.connectors.google.clientId')===client&&this.accounts().find(a=>a.email===email)?.refreshEnc===saved.refreshEnc;
  try{
   const token=await api.token(api.one(email));if(!current())return{...result,error:'Request cancelled or account changed.'};
   const metrics=await Promise.all(METRICS.map(async([type,label,field,value,unit])=>{
    try{
     const res=await this.fetch(`https://health.googleapis.com/v4/users/me/dataTypes/${type}/dataPoints:dailyRollUp`,{method:'POST',redirect:'error',signal:AbortSignal.any([ac.signal,AbortSignal.timeout(15000)]),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({range,windowSizeDays:1,pageSize:14,dataSourceFamily:'users/me/dataSourceFamilies/google-wearables'})});
     if(!res.ok)throw Error(res.status===401?'Sign-in expired; reconnect Google.':res.status===403?'Permission denied: enable Google Health API and reconnect with Health permissions.':res.status===429?'Google is rate limiting requests. Wait and refresh.':'Google Health is unavailable. Try again later.');
     const data=await res.json();return {label,unit,points:pointsFor(data,field,value),...(type==='heart-rate'?{minimum:pointsFor(data,field,'beatsPerMinuteMin'),maximum:pointsFor(data,field,'beatsPerMinuteMax')}:{})};
    }catch(e){return {label,unit,points:[],error:ac.signal.aborted?'Cancelled.':e.name==='TimeoutError'?'Google Health timed out. Try again.':/^Google|^Permission|^Sign-in/.test(e.message)?e.message:'Could not retrieve this metric. Check your network and retry.'};}
   }));
   if(!current())return{...result,error:'Request cancelled or account changed.'};
   return{...result,email,metrics,progress:require('./fitnessGoals').stepProgress(metrics.find(m=>m.unit==='steps')?.points.find(p=>p.date===day)?.value,result.goal),checkedAt:new Date(this.now()).toISOString()};
  }catch{return{...result,error:'Google sign-in could not refresh. Reconnect this account in Connections.'};}finally{if(this.pending===ac)this.pending=null;}
 }
}
module.exports={FitnessStats,fitnessIntent,rangeFor,pointsFor,dayKey};
