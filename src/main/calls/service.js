const crypto=require('crypto');
const {DEFAULT_VOICE}=require('./bland');
const {nextRun,parseScheduleCommand,MISSED_MS}=require('../schedule');
const {isSecret}=require('../memory');
const DEFAULTS={enabled:false,immediate:true,ownerNumber:'',voice:DEFAULT_VOICE,maxDuration:2,dailyCalls:2,dailyMinutes:10,quiet:true,quietStart:21,quietEnd:8,offerOnCompletion:false,fastReply:true,provider:'auto',twilioSid:'',twilioFrom:'',twilioVoice:'Polly.Brian'};
const ACTIVE=new Set(['sending','queued','active','uncertain','stop-requested']);
const day=at=>{const d=new Date(at);return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;};
function quiet(cfg,now){if(!cfg.quiet)return false;const hour=new Date(now).getHours();return cfg.quietStart===cfg.quietEnd|| (cfg.quietStart<cfg.quietEnd?hour>=cfg.quietStart&&hour<cfg.quietEnd:hour>=cfg.quietStart||hour<cfg.quietEnd);}
function number(raw){const value=String(raw||'').replace(/[ ()-]/g,'');if(!/^\+[1-9]\d{7,14}$/.test(value))throw Error('Use an international number, such as +1 followed by 10 digits.');return value;}
function purpose(raw){const value=String(raw||'').trim();if(!value||value.length>1200)throw Error('Give the call a purpose of 1–1,200 characters.');if(isSecret(value))throw Error('Remove passwords, keys or other credentials from the call purpose.');return value;}
class Calls {
  constructor({store,api,twilio=null,hasKey=()=>false,hasTwilio=()=>false,privateMode=()=>false,now=Date.now,onChange=()=>{},onReview=()=>{}}){Object.assign(this,{store,api,twilio,hasKey,hasTwilio,privateMode,now,onChange,onReview});this.reviewing=new Set();this.polling=new Set();
    let changed=false;for(const r of this.items()){if(r.state==='sending'){r.state='uncertain';r.error='Relay stopped during sending. Check Bland before preparing another call.';changed=true;}}if(changed)this.save();
  }
  config(){return{...DEFAULTS,...this.store.get('settings.calls')};}
  items(){return this.store.get('callRequests')||[];}
  // Is some provider set up for the chosen mode? "auto" is Bland first, and Twilio only if Bland definitely could not place the call.
  ready(){const p=this.config().provider||'auto';return p==='twilio'?!!this.hasTwilio():p==='bland'?!!this.hasKey():!!(this.hasKey()||this.hasTwilio());}
  apiFor(r){return r&&r.provider==='twilio'?this.twilio:this.api;}
  name(r){return r&&r.provider==='twilio'?'Twilio':'Bland';}
  schedules(){return this.store.get('callSchedules')||[];}
  save(){this.store.flush();try{this.onChange();}catch{}}
  state(){const {keyEnc,twilioTokenEnc,...config}=this.config();return{config,hasKey:this.hasKey(),hasTwilio:this.hasTwilio(),ready:this.ready(),privateMode:this.privateMode(),requests:this.items().slice(-100).reverse(),schedules:this.schedules(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};}
  configure(raw){
    const old=this.config(),cfg={...old};
    for(const k of ['enabled','immediate','quiet','offerOnCompletion','fastReply'])if(k in raw)cfg[k]=!!raw[k];
    if('voice'in raw){if(typeof raw.voice!=='string'||!/^[-a-zA-Z0-9_ ]{1,128}$/.test(raw.voice))throw Error('Use a valid Bland voice name or ID.');cfg.voice=raw.voice;}
    if('ownerNumber'in raw)cfg.ownerNumber=raw.ownerNumber?number(raw.ownerNumber):'';
    if('provider'in raw){if(!['auto','bland','twilio'].includes(raw.provider))throw Error('Choose Bland, Twilio, or Bland with a Twilio fallback.');cfg.provider=raw.provider;}
    if('twilioSid'in raw){const v=String(raw.twilioSid||'').trim();if(v&&!/^AC[0-9a-fA-F]{32}$/.test(v))throw Error('A Twilio account SID starts with AC and has 34 characters.');cfg.twilioSid=v;}
    if('twilioFrom'in raw)cfg.twilioFrom=raw.twilioFrom?number(raw.twilioFrom):'';
    if('twilioVoice'in raw){const v=String(raw.twilioVoice||'').trim()||'Polly.Brian';if(!/^[A-Za-z][A-Za-z0-9.-]{1,40}$/.test(v))throw Error('Use a valid Twilio voice name, such as Polly.Brian.');cfg.twilioVoice=v;}
    for(const [k,min,max]of [['maxDuration',1,5],['dailyCalls',1,10],['dailyMinutes',1,60],['quietStart',0,23],['quietEnd',0,23]])if(k in raw){if(!Number.isInteger(Number(raw[k]))||+raw[k]<min||+raw[k]>max)throw Error(`${k} must be between ${min} and ${max}.`);cfg[k]=+raw[k];}
    this.store.set('settings.calls',cfg);this.save();return this.state();
  }
  prepare(raw,{source='manual',occurrence=null,silent=false}={}){
    const cfg=this.config(),to=number(cfg.ownerNumber),text=purpose(raw);
    if(occurrence){const existing=this.items().find(r=>r.occurrence===occurrence);if(existing)return existing;}
    if(this.items().filter(r=>r.state==='review'&&r.expires>this.now()).length>=10)throw Error('Ten calls await review. Cancel or review them first.');
    const r={id:crypto.randomUUID(),number:to,purpose:text,minutes:cfg.maxDuration,voice:cfg.voice,fast:cfg.fastReply!==false,created:this.now(),expires:this.now()+15*60000,state:'review',source,...(occurrence?{occurrence}:{})};
    this.store.data.callRequests=[...this.items(),r];this.save();try{if(!silent)this.onReview(r);}catch{}return r;
  }
  async requestOwnerCall(text,{background=false}={}){
    const r=this.prepare(text,{source:background?'schedule':'voice'});
    if(background||!this.config().immediate)return{review:true};
    return this.approve(r.id,async()=>true); // An explicit current owner command authorizes this saved destination.
  }
  validate(r){
    const cfg=this.config();
    if(!cfg.enabled)throw Error('Enable phone calls in Calls settings.');if(this.privateMode())throw Error('Phone calls use Bland. They are disabled in local/private mode.');if(!this.ready())throw Error(this.config().provider==='twilio'?'Add your Twilio account details first.':'Add your Bland API key first.');
    if(r.number!==cfg.ownerNumber)throw Error('The owner number changed. Prepare a fresh call.');if(r.minutes>cfg.maxDuration)throw Error('The duration limit changed. Prepare a fresh call.');
    if(quiet(cfg,this.now()))throw Error('It is quiet hours. Change the schedule or quiet-hours setting.');
    const used=this.items().filter(x=>x.sentAt&&day(x.sentAt)===day(this.now()));
    if(used.length>=cfg.dailyCalls||used.reduce((n,x)=>n+x.minutes,0)+r.minutes>cfg.dailyMinutes)throw Error('Today’s local call/minute limit has been reached.');
    if(this.items().some(x=>ACTIVE.has(x.state)))throw Error('Another call is active or uncertain. Review its outcome first.');
  }
  async approve(id,confirm){
    const r=this.items().find(x=>x.id===id);if(!r||r.state!=='review'||r.expires<=this.now())throw Error('This approval expired. Prepare a new call.');if(this.reviewing.has(id))throw Error('This call is already being reviewed.');
    this.reviewing.add(id);
    try{
      this.validate(r);
      if(!await confirm({number:r.number,purpose:r.purpose,minutes:r.minutes,voice:r.voice||DEFAULT_VOICE}))return{cancelled:true};
      if(r.state!=='review'||r.expires<=this.now())throw Error('This approval is no longer current.');this.validate(r);
      r.state='sending';r.sentAt=this.now();this.save(); // durable reservation before the only outbound POST
      try{const result=await this.place(r);r.callId=result.callId;r.provider=result.provider;r.state='queued';r.error='';this.save();return{ok:true};}
      catch(e){r.state='uncertain';r.error=e.message;this.save();return{error:r.error};}
    }finally{this.reviewing.delete(id);}
  }
  // Places the call with the chosen provider. In "auto", Twilio is tried only after Bland answered with a definite refusal (no balance, rejected key): never after an unclear
  // network failure, because the call may already be ringing and a second one would call you twice.
  async place(r){
    const mode=this.config().provider||'auto',order=mode==='twilio'?['twilio']:mode==='bland'?['bland']:[this.hasKey()?'bland':null,this.hasTwilio()&&this.twilio?'twilio':null].filter(Boolean);
    let last;
    for(const name of order){
      try{const out=await (name==='twilio'?this.twilio:this.api).dial({...r});return{...out,provider:name};}
      catch(e){last=e;if(name==='bland'&&order.includes('twilio')&&e.fallbackOk){r.fellBack=`Bland could not place the call (${String(e.message).slice(0,120)}), so Twilio read the message instead.`;continue;}throw e;}
    }
    throw last||Error('No phone provider is set up.');
  }
  cancel(id){const r=this.items().find(x=>x.id===id);if(!r||r.state!=='review')throw Error('Only a pending review can be cancelled here.');r.state='cancelled';this.save();}
  async refresh(id){
    const r=this.items().find(x=>x.id===id);if(!r?.callId)throw Error('No confirmed call ID. Check the provider’s dashboard.');if(this.privateMode())throw Error(`${this.name(r)} access is disabled in local/private mode.`);if(this.polling.has(id))return;this.polling.add(id);
    try{const data=await this.apiFor(r).details(r.callId);const ended=data.completed===true||/^(?:complete|completed|ended|failed|no-answer|busy|cancelled)$/.test(data.status||'')||String(data.status).endsWith('_error');r.providerStatus=String(data.status||'unknown').slice(0,60);r.state=ended?(data.error_message||/failed|error/.test(String(data.status))?'failed':'completed'):'active';r.answeredBy=['human','voicemail'].includes(data.answered_by)?data.answered_by:'unknown';r.outcome=data.error_message?'Provider reported a problem':r.providerStatus;r.minutesUsed=Number.isFinite(data.call_length)?data.call_length:null;r.price=Number.isFinite(data.price)?data.price:null;r.lastChecked=this.now();r.error='';this.save();return{ok:true};}
    catch(e){r.error=e.message;this.save();return{error:r.error};}finally{this.polling.delete(id);}
  }
  async stop(id){const r=this.items().find(x=>x.id===id);if(!r?.callId||!ACTIVE.has(r.state))throw Error('No active call with a known ID.');if(this.privateMode())throw Error(`${this.name(r)} access is disabled in local/private mode.`);await this.apiFor(r).stop(r.callId);r.state='stop-requested';this.save();return{ok:true};}
  acknowledge(id){const r=this.items().find(x=>x.id===id);if(!r||r.state!=='uncertain')throw Error('Only uncertain calls can be marked reviewed.');r.state='reviewed';r.outcome='User reviewed the provider dashboard; Relay did not verify the outcome.';this.save();}
  async report(id){const r=this.items().find(x=>x.id===id);if(!r?.callId)throw Error('No confirmed call ID.');if(this.privateMode())throw Error(`${this.name(r)} access is disabled in local/private mode.`);const data=await this.apiFor(r).details(r.callId);return{summary:String(data.summary||'No summary available.').slice(0,5000),transcript:String(data.concatenated_transcript||'No transcript available.').slice(0,30000)};}
  addSchedule(raw){
    if(this.schedules().length>=20)throw Error('Twenty call check-ins are already scheduled.');number(this.config().ownerNumber);
    const cfg=this.config(),automatic=raw.automatic===true;if(automatic&&(!cfg.enabled||!this.ready()||this.privateMode()))throw Error('Enable calls and connect a provider before authorizing automatic calls.');
    const s={automatic,authorization:automatic?{number:cfg.ownerNumber,minutes:cfg.maxDuration,voice:cfg.voice,provider:cfg.provider}:null,id:crypto.randomUUID(),text:purpose(raw.purpose),repeat:raw.repeat,hour:+raw.hour,minute:+raw.minute,days:raw.days||[],at:raw.at,enabled:true};
    if(!['once','daily','weekdays','weekends','weekly'].includes(s.repeat)||!Array.isArray(s.days)||s.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Choose a valid repeat pattern.');
    if(s.repeat!=='once'&&(!Number.isInteger(s.hour)||s.hour<0||s.hour>23||!Number.isInteger(s.minute)||s.minute<0||s.minute>59))throw Error('Choose a valid check-in time.');
    if(s.repeat==='once'&&(!Number.isFinite(s.at)||!Number.isFinite(+new Date(s.at))||s.at<=this.now()||s.at>this.now()+366*86400000))throw Error('Choose a future time within the next year.');s.next=nextRun(s,new Date(this.now()));if(!s.next)throw Error('The schedule has no next occurrence.');this.store.data.callSchedules=[...this.schedules(),s];this.save();return s;
  }
  removeSchedule(id){this.store.data.callSchedules=this.schedules().filter(s=>s.id!==id);this.save();}
  async tick(){
    let changed=false;const now=this.now(),cfg=this.config();
    for(const r of this.items())if(r.state==='review'&&r.expires<=now){r.state='expired';changed=true;}
    for(const s of this.schedules())if(s.enabled&&s.next<=now){
      const occurrence=s.id+':'+s.next;s.next=s.repeat==='once'?null:nextRun(s,new Date(now));if(!s.next)s.enabled=false;
      if(cfg.enabled&&!quiet(cfg,now)&&!this.privateMode()&&now-Number(occurrence.split(':').at(-1))<=MISSED_MS){try{const r=this.prepare(s.text,{source:'schedule',occurrence,silent:s.automatic===true});if(s.automatic===true){const a=s.authorization;if(!a||a.number!==cfg.ownerNumber||a.minutes!==cfg.maxDuration||a.voice!==cfg.voice||a.provider!==cfg.provider){s.error='Call settings changed. Recreate this schedule to authorize them.';this.onReview(r);}else{const result=await this.approve(r.id,async()=>true);s.error=result.error||'';}}}catch(e){s.error=e.message;}}else s.error='Check-in was missed, disabled or in quiet/private mode; no call was placed.';changed=true;
    }
    if(changed)this.save();
    await Promise.all(this.items().filter(r=>r.callId&&ACTIVE.has(r.state)).map(r=>this.refresh(r.id)));
  }
}
function parseCallCommand(raw){
  const text=String(raw||'').trim().replace(/^(?:(?:hey|ok|okay) )?(?:jarvis|relay)[, ]+/i,'').replace(/[.!?]+$/,'');
  if(/^(?:show|open)(?: me)? (?:my |the )?(?:phone )?calls?(?: menu| settings| history)?$/i.test(text))return{type:'open'};
  const scheduled=parseScheduleCommand(/^schedule\b/i.test(text)?text:'schedule '+text);
  const callText=scheduled?.type==='schedule-add'?scheduled.text:text;
  const m=/^(?:please )?(?:call|phone|ring) me(?: (?:about|to|and|for))?(?: (.+))?$/i.exec(callText);if(!m)return null;
  const why=m[1]||'A brief check-in. Ask how I am doing and whether I need anything.';
  return scheduled?.type==='schedule-add'?{type:'schedule',spec:{...scheduled,purpose:why}}:{type:'prepare',purpose:why};
}
module.exports={Calls,DEFAULTS,quiet,number,purpose,parseCallCommand};
