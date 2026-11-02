// Fixed provider endpoints. Keys stay in the main process; response bodies are never logged.
const DEFAULT_VOICE='fd9c6765-a2ce-429a-abc7-00be9d1e3a92'; // tanner-british: Professional British Male, verified in Bland’s voice catalog.
class Bland {
  constructor({getKey,fetchFn=fetch}){Object.assign(this,{getKey,fetchFn});}
  async request(path,{method='GET',body}={}){
    const key=this.getKey();if(!key)throw Error('Add your Bland API key in Calls settings.');
    let response;
    try{response=await this.fetchFn('https://api.bland.ai/v1'+path,{method,headers:{authorization:key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Bland could not be reached. The call outcome may be uncertain; check Bland before trying again.');}
    if(!response.ok)throw Error(response.status===401||response.status===403?'Bland rejected the key or access.':response.status===402?'Bland billing or balance needs attention.':`Bland request failed (HTTP ${response.status}).`);
    let data;try{data=await response.json();}catch{throw Error('Bland returned an unreadable response. Check its call history before retrying.');}
    if(data?.status==='error')throw Error('Bland reported an error. Check its dashboard for details.');return data;
  }
  async check(){await this.request('/me');return{ok:true};}
  async dial(request){
    const data=await this.request('/calls',{method:'POST',body:{phone_number:request.number,voice:request.voice||DEFAULT_VOICE,max_duration:request.minutes,record:false,wait_for_greeting:true,voicemail_action:'hangup',metadata:{relay_request_id:request.id},
      first_sentence:'Hello, this is Jarvis, your AI assistant. Is this a good time for your requested check-in?',
      task:`You are Jarvis, an AI assistant calling the owner for this purpose: ${request.purpose}\nIdentify yourself as AI. Confirm you reached the owner before discussing any private details. If another person answers, do not disclose the purpose; ask for the owner and end the call if unavailable. Speak naturally and politely in complete sentences, addressing the owner as Sir. Keep it brief. Never ask for passwords, verification codes or payment details. Do not pretend to have completed work. Do not transfer, send messages, execute commands, make purchases, or promise actions on the Mac. Capture any requested follow-up in the call summary for the owner to review. End politely when the owner says no or goodbye.`}});
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(data?.call_id||''))throw Error('Bland did not return a verifiable call ID. Check Bland before retrying.');return{callId:data.call_id};
  }
  id(value){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(value||''))throw Error('No valid call ID.');return value;}
  details(id){return this.request('/calls/'+this.id(id));}
  stop(id){return this.request('/calls/'+this.id(id)+'/stop',{method:'POST'});}
}
module.exports={Bland,DEFAULT_VOICE};
