const {schoolUrl,openSchoolPage,readSchoolPage,schoolProblem}=require('../school');
function registerSchoolConnection({ipcMain,store,getWindow,getBridge,openFirefox,checkAssignments,onChange}){
 const url=()=>store.get('settings.briefing.schoolUrl')||'';
 const handle=(name,fn)=>ipcMain.handle('connectors:school:'+name,async(e,...args)=>{if(e.sender!==getWindow()?.webContents)return{ok:false,error:'Open Connections on this Mac.'};try{return await fn(...args);}catch{return{ok:false,error:'The school connection could not finish. Open the assignment center in signed-in Firefox and retry.'};}});
 handle('save',value=>{const target=schoolUrl(value);if(!target)return{ok:false,error:schoolProblem('invalid-url')};store.set('settings.briefing.schoolUrl',target.href);store.flush();onChange();return{ok:true};});
 handle('connect',async()=>{const target=schoolUrl(url());if(!target)return{ok:false,error:schoolProblem('invalid-url')};const bridge=getBridge();if(bridge?.isConnected())return openSchoolPage(bridge,target.href);await openFirefox(target.href);return{ok:true,message:'Firefox opened. Sign in to your school and enable the Relay Firefox extension before checking assignments.'};});
 handle('check',async()=>{const r=await readSchoolPage(getBridge(),url());return r.ok?{ok:true,message:'The assignment page is readable in Firefox. This checks the page connection only, not whether every assignment is loaded.'}:{ok:false,error:schoolProblem(r.reason)};});
 handle('assignments',async()=>{const r=await checkAssignments();return{ok:r.status==='done',message:r.reply,error:r.status==='done'?undefined:r.reply};});
}
module.exports={registerSchoolConnection};
