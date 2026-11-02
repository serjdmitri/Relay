const crypto=require('crypto');
const {isSecret}=require('./memory');
const {exportOutput}=require('./memoryExport');
function parseSessionCommand(raw){const text=String(raw||'').trim().replace(/^(?:(?:hey|okay|ok) )?(?:jarvis|relay)[, ]+/i,'').replace(/[.!?]+$/,'');const match=/^(start|stop|show|open|export)(?: my| the)? session notes$/i.exec(text);if(match)return{action:match[1].toLowerCase()};const search=/^(?:search|find)(?: my| the)? session notes for (.{1,200})$/i.exec(text);return search?{action:'search',query:search[1]}:null;}
function clean(text,max){const value=String(text||'').trim();return isSecret(value)?'[Omitted: possible credentials]':value.slice(0,max);}
function formatSession(s){return`Session: ${s.title}\nCreated: ${new Date(s.created).toISOString()}\nSource: opt-in Relay conversation notes, not independently verified facts\n${s.ended?'Ended: '+new Date(s.ended).toISOString()+'\n':''}\n${s.entries.map(e=>`[${new Date(e.ts).toISOString()}] ${e.status}${e.editedAt?' (user corrected)':''}\nYou: ${e.request}\nJarvis: ${e.reply}`).join('\n\n')}`;}
class SessionNotes{
 constructor({store,now=Date.now,onChange=()=>{}}){Object.assign(this,{store,now,onChange});this.active=null;this.warning='';}
 items(){return this.store.get('sessionNotes')||[];}
 state(query=''){const q=String(query).trim().slice(0,200).toLowerCase();return{active:this.active,warning:this.warning,sessions:this.items().filter(s=>!q||(s.title+' '+s.entries.map(e=>e.request+' '+e.reply).join(' ')).toLowerCase().includes(q))};}
 save(items=this.items()){this.store.set('sessionNotes',items);this.store.flush();this.onChange();}
 start(){if(this.store.get('settings.memory')===false)throw Error('Enable memory before starting session notes.');if(this.active)return this.active;if(this.items().length>=20)throw Error('Twenty sessions are saved. Review and remove old sessions before starting another.');const s={id:crypto.randomUUID(),title:'Session '+new Date(this.now()).toLocaleString(),created:this.now(),entries:[]};this.save([s,...this.items()]);this.active=s.id;this.warning='';this.onChange();return s.id;}
 stop(){const s=this.items().find(s=>s.id===this.active);this.active=null;if(s){s.ended=this.now();this.save();}else this.onChange();}
 capture(entry){
  if(!this.active)return;if(this.store.get('settings.memory')===false){this.stop();return;}
  const s=this.items().find(s=>s.id===this.active);if(!s){this.active=null;return;}
  if(!['done','failed','stopped'].includes(entry.status)||!entry.text||entry.ts<s.created||entry.remote||/^(?:Agent:|Scheduled:)/i.test(entry.text)||parseSessionCommand(entry.text)||s.entries.some(e=>e.requestId===entry.id))return;
  if(s.entries.length>=100){this.warning='Session notes stopped at 100 entries. Start another session to continue.';this.stop();return;}
  s.entries.push({id:crypto.randomUUID(),requestId:entry.id,ts:this.now(),status:entry.status,request:clean(entry.text,4000),reply:clean(entry.reply,12000)});
  try{this.save();}catch{this.active=null;this.warning='Session notes could not be saved. Notes are now stopped.';this.onChange();}
 }
 update({id,title,entryId,request,reply}){const s=this.items().find(s=>s.id===id);if(!s)throw Error('Session not found.');let e;
  if(typeof title==='string'&&(!title.trim()||title.length>120||isSecret(title)))throw Error('Choose a session title without credentials, up to 120 characters.');
  if(entryId){e=s.entries.find(e=>e.id===entryId);if(!e)throw Error('Note not found.');if(typeof request!=='string'||typeof reply!=='string'||request.length>4000||reply.length>12000||isSecret(request)||isSecret(reply))throw Error('Keep corrected notes within their limits and remove credentials.');}
  if(typeof title==='string')s.title=title.trim();if(e)Object.assign(e,{request,reply,editedAt:this.now()});this.save();
 }
 remove(id){if(!this.items().some(s=>s.id===id))throw Error('Session not found.');if(this.active===id)this.active=null;this.save(this.items().filter(s=>s.id!==id));}
 export(id,dir){const s=this.items().find(s=>s.id===id);if(!s)throw Error('Session not found.');return exportOutput(dir,'Session notes: '+s.title,formatSession(s));}
}
function registerSessionNotes({ipcMain,store,getWindow,onChange,exportDir,confirmDelete,openMemory,showMatches}){
 const notes=new SessionNotes({store,onChange});
 const act=async(action,value)=>{if(action==='state')return notes.state(value);if(action==='start')notes.start();else if(action==='stop')notes.stop();else if(action==='update')notes.update(value||{});else if(action==='delete'){if(!await confirmDelete())return{ok:false,cancelled:true};notes.remove(value);}else if(action==='export')return{ok:true,file:notes.export(value,exportDir())};else throw Error('Unknown session-note action.');return{ok:true,...notes.state()};};
 ipcMain.handle('notes:session',async(e,action,value)=>{if(e.sender!==getWindow()?.webContents)return{ok:false,error:'Open Memory on this Mac.'};try{return await act(action,value);}catch(e){return{ok:false,error:e.message};}});
 notes.command=async command=>{try{if(command.action==='start'){notes.start();return{status:'done',reply:'Session notes are on, Sir. Your foreground requests and replies will be saved locally until you stop notes or quit Relay.'};}if(command.action==='stop'){notes.stop();return{status:'done',reply:'Session notes are stopped, Sir.'};}if(command.action==='export'){const latest=notes.items()[0];if(!latest)throw Error('No session notes are saved.');const file=notes.export(latest.id,exportDir());return{status:'done',reply:'The latest session was exported to Desktop/memory for manual import, Sir. It has not been saved to Sentient OS.',file};}if(command.action==='search'){const result=notes.state(command.query);await showMatches(result.sessions.slice(0,5),command.query);return{status:'done',reply:result.sessions.length?`Found ${result.sessions.length} matching local sessions, Sir. Review the notes menu.`:'No matching local sessions were found, Sir.'};}openMemory();return{status:'done',reply:'Session notes are in Memory, Sir.'};}catch(e){return{status:'failed',reply:e.message};}};
 return notes;
}
module.exports={SessionNotes,parseSessionCommand,formatSession,registerSessionNotes};
