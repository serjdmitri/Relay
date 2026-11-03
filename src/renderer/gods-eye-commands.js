// Executes a small allowlist through God’s Eye's existing action runner, entirely inside its sandbox.
window.__relayGodsEyeCommand=async command=>{
 const app=window.__godsEyeView,runner=app?.voiceCommands?.runner;
 if(typeof runner!=='function')return {ok:false,error:'God’s Eye controls are still loading. Try again in a moment.'};
 const ac=new AbortController();window.__relayGodsEyeAbort=ac;const timeout=setTimeout(()=>ac.abort(),25000);
 const run=async(name,args)=>{ac.signal.throwIfAborted();const r=await runner(name,args,{signal:ac.signal});if(r?.ok===false||r?.error)throw Error(r.error||r.say||'The source could not apply that change.');return r;};
 try{
  if(command.place)await run('fly_to_location',{query:command.place});
  if(command.type==='place')return {ok:true};
  if(command.type==='reset'){document.getElementById('reset-globe-view')?.click();return {ok:true};}
  if(command.type==='layer'){
   if(!['flights','satellites','earthquakes','vessels'].includes(command.layer))throw Error('Unsupported map layer.');
   const r=await run('set_layer_visibility',{layerId:command.layer,enabled:command.enabled===true});return {ok:true,summary:r?.say||''};
  }
  if(command.type!=='camera')throw Error('Unsupported world command.');
  await run('set_layer_visibility',{layerId:'cctv',enabled:command.action!=='hide'});
  if(command.action==='hide'||command.action==='show')return {ok:true};
  if(!['nearest','next','prev'].includes(command.action))throw Error('Unsupported camera action.');
  const r=await run('control_cctv',{action:command.action});
  if(!r?.activeCameraId&&!r?.activeCamera&&!r?.selected)throw Error('The public-camera catalog has no available camera for this view. Try a supported city such as London or Austin.');
  return {ok:true,camera:String(r.selected||r.activeCamera||'Public camera').slice(0,160)};
 }catch(e){return {ok:false,error:ac.signal.aborted?'Map command stopped or timed out.':String(e.message).slice(0,300)};}
 finally{clearTimeout(timeout);if(window.__relayGodsEyeAbort===ac)window.__relayGodsEyeAbort=null;}
};

void 0;
