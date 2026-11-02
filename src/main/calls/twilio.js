// Twilio, as a plain-message fallback for Jarvis calls: it phones you and reads the purpose aloud (one way, no conversation). Same shape as the
// Bland client (dial, details, stop, check) so the review, approval and status flow is shared. Fixed endpoint; the token only goes in the
// Authorization header and is never logged or returned. On a Twilio trial account the person who answers first hears a trial notice and must
// press a key before the message plays; a trial can only call numbers verified in Twilio.
const DEFAULT_VOICE='Polly.Brian'; // British male, a standard Twilio <Say> voice
const SID=/^AC[0-9a-f]{32}$/i, CALL_SID=/^CA[0-9a-f]{32}$/i;
const xml=s=>String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
// What the call says: who is calling, the purpose twice (a call is easy to miss the start of), then goodbye.
function messageFor(request){const purpose=String(request.purpose||'').replace(/\s+/g,' ').trim().slice(0,600);return{intro:'Hello, this is Jarvis, your AI assistant. You asked me to call you about the following.',purpose,repeat:'Once more.',outro:'That is all. Goodbye, Sir.'};}
function twimlFor(request,voice=DEFAULT_VOICE){
  const m=messageFor(request),v=xml(/^[A-Za-z][A-Za-z0-9.-]{1,40}$/.test(voice)?voice:DEFAULT_VOICE),say=t=>`<Say voice="${v}">${xml(t)}</Say>`;
  return `<Response>${say(m.intro)}<Pause length="1"/>${say(m.purpose)}<Pause length="2"/>${say(m.repeat)}${say(m.purpose)}<Pause length="1"/>${say(m.outro)}<Hangup/></Response>`;
}
const STATUS={queued:'queued',ringing:'ringing','in-progress':'in-progress',completed:'completed',busy:'busy',failed:'failed','no-answer':'no-answer',canceled:'cancelled'};
class Twilio {
  constructor({getCreds,fetchFn=fetch}){Object.assign(this,{getCreds,fetchFn});}
  creds(){const c=this.getCreds();if(!c||!SID.test(c.sid||'')||!c.token||!c.from)throw Error('Add your Twilio account SID, auth token and Twilio phone number in Calls settings.');return c;}
  async request(path,{method='GET',form}={}){
    const c=this.creds();let response;
    try{response=await this.fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${c.sid}${path}`,{method,headers:{authorization:'Basic '+Buffer.from(`${c.sid}:${c.token}`).toString('base64'),...(form?{'content-type':'application/x-www-form-urlencoded'}:{})},...(form?{body:new URLSearchParams(form).toString()}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw Error('Twilio could not be reached. The call outcome may be uncertain; check Twilio before trying again.');}
    let data=null;try{data=await response.json();}catch{ /* an error page or an empty body */ }
    if(!response.ok){
      const e=Error(response.status===401||response.status===403?'Twilio rejected the account SID or auth token.':data?.code===21219||data?.code===21608?'This Twilio trial account can only call numbers you verified in Twilio. Verify your number there first.':data?.code===21211?'Twilio did not accept that phone number.':data?.code===21212||data?.code===21603?'Twilio did not accept the Twilio phone number.':data?.code===20003?'Twilio rejected the account SID or auth token.':`Twilio request failed (HTTP ${response.status}${data?.code?`, code ${data.code}`:''}).`);
      e.fallbackOk=false;throw e; // a rejected request placed nothing, but there is nothing further to fall back to
    }
    if(!data)throw Error('Twilio returned an unreadable response. Check its call log before retrying.');return data;
  }
  async check(){const d=await this.request('.json');if(d.status&&d.status!=='active')throw Error(`The Twilio account is ${String(d.status).slice(0,20)}.`);return{ok:true,trial:/trial/i.test(d.type||'')};}
  async dial(request){
    const c=this.creds(),cfg=this.getCreds();
    const data=await this.request('/Calls.json',{method:'POST',form:{To:request.number,From:c.from,Twiml:twimlFor(request,cfg.voice)}});
    if(!CALL_SID.test(data?.sid||''))throw Error('Twilio did not return a verifiable call ID. Check Twilio before retrying.');return{callId:data.sid};
  }
  id(value){if(!CALL_SID.test(value||''))throw Error('No valid call ID.');return value;}
  // Shaped like Bland's call details, so the shared service reads both.
  async details(id){
    const d=await this.request(`/Calls/${this.id(id)}.json`),status=STATUS[d.status]||'unknown',secs=Number(d.duration),price=d.price==null?null:Math.abs(Number(d.price));
    const done=['completed','busy','failed','no-answer','cancelled'].includes(status);
    return{status,completed:done,answered_by:status==='completed'&&secs>0?'human':'unknown',call_length:Number.isFinite(secs)?secs/60:null,price:Number.isFinite(price)?price:null,
      error_message:status==='failed'?'Twilio could not complete the call.':'',summary:`Twilio ${status==='completed'?(secs>0?`read your message aloud${Number.isFinite(secs)?` (${secs} seconds)`:''}`:'ended before the message played'):`call ended: ${status}`}. This is a one-way message call, so there is no conversation.`,concatenated_transcript:'One-way message; no conversation was recorded.'};
  }
  async stop(id){const d=await this.request(`/Calls/${this.id(id)}.json`);return this.request(`/Calls/${this.id(id)}.json`,{method:'POST',form:{Status:d.status==='in-progress'?'completed':'canceled'}});}
}
module.exports={Twilio,DEFAULT_VOICE,twimlFor,messageFor,SID};
