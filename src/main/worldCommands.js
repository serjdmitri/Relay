// Native intent routing is shared by all Relay model providers; these commands need no model call.
function parseWorldCommand(text){
 const n=String(text||'').trim().replace(/^(?:hey\s+)?jarvis[, ]+/i,'').replace(/^please\s+/i,'').replace(/[.!?]+$/,'');
 if(/\b(?:webcam|facetime|my camera|camera permission|hand controls?|enroll|record|take a photo)\b/i.test(n))return null;
 const location=/\s+(?:in|near|over|around|at|to)\s+(.+?)(?:\s+(?:in|on)\s+(?:god[’']?s? eye(?: view)?|the map))?$/i.exec(n);
 const place=location && !/^(?:me|here|this area|the current (?:map|view)|god[’']?s? eye(?: view)?)$/i.test(location[1])?location[1].slice(0,160):null;
 const near=/\b(?:closest|cloesst|nearest|nearby)\b/i.test(n);
 if(/\b(?:camera|cameras|cctv)\b/i.test(n)&&(/\b(?:show|find|open|where|next|previous|prev|hide|disable|turn|enable)\b/i.test(n)||near))return {type:'camera',place,action:/\b(?:hide|disable|off)\b/i.test(n)?'hide':/\b(?:next)\b/i.test(n)?'next':/\b(?:previous|prev)\b/i.test(n)?'prev':near?'nearest':'show'};
 if(/\b(?:show|display|track|map|hide|disable|enable|turn on|turn off|where are)\b/i.test(n)){
  const layers=[[/\b(?:flights?|planes?|aircraft)\b/i,'flights'],[/\bsatellites?\b/i,'satellites'],[/\bearthquakes?\b/i,'earthquakes'],[/\b(?:ships?|vessels?)\b/i,'vessels']];
  const match=layers.find(([re])=>re.test(n));if(match)return {type:'layer',layer:match[1],enabled:!(/\b(?:hide|disable|off)\b/i.test(n)),place};
 }
 if(/^(?:zoom out|reset (?:the )?(?:globe|world)|show (?:the )?(?:whole (?:earth|world)|globe))$/i.test(n))return {type:'reset'};
 const fly=/^(?:fly to|zoom (?:in )?to|show me)\s+(.+?)(?:\s+(?:in|on)\s+(?:god[’']?s? eye(?: view)?|the (?:globe|map)))$/i.exec(n)||/^(?:fly to|zoom to)\s+(.+)$/i.exec(n);
 return fly?{type:'place',place:fly[1].slice(0,160)}:null;
}
function worldReply(command,result){
 if(!result?.ok)return {status:'failed',reply:result?.error||'God’s Eye could not complete that command, Sir.',actions:0};
 const basis=command.place?` near ${command.place}`:' relative to the current map view';
 const reply=command.type==='camera'?command.action==='hide'?'Public cameras are hidden, Sir.':command.action==='nearest'||command.action==='next'||command.action==='prev'?`I selected ${result.camera||'an available public camera'}${basis}, Sir. Feed availability depends on the provider.`:`Public cameras are shown${basis}, Sir.`:command.type==='layer'?`${command.layer.charAt(0).toUpperCase()+command.layer.slice(1)} are ${command.enabled?'shown':'hidden'}${command.place?' around '+command.place:''}, Sir. The layer reports its data freshness.`:command.type==='reset'?'The whole globe is back in view, Sir.':`I moved the map to ${command.place}, Sir.`;
 return {status:'done',reply,actions:1};
}
module.exports={parseWorldCommand,worldReply};
