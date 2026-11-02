const restoreButton=document.getElementById('restore'),restoreStatus=document.getElementById('status');
relay.onRestoreOffer(()=>{restoreButton.disabled=false;restoreStatus.textContent='Item dismissed';});
restoreButton.onclick=async()=>{
  restoreButton.disabled=true;restoreStatus.textContent='Restoring…';
  try{const result=await relay.restoreThrow();if(!result?.ok)restoreStatus.textContent=result?.error||'Nothing to restore';}
  catch{restoreStatus.textContent='Could not restore. Try again.';}
  finally{restoreButton.disabled=false;}
};
