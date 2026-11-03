// Runs only in the local map sandbox. Keep upstream state/controls intact while choosing the clean globe start.
(()=>{let attempts=0,resetDone=false;const timer=setInterval(()=>{
 const launcher=document.getElementById('first-run-launcher');
 const explore=launcher?.querySelector('[data-first-run-dismiss]');
 if(attempts>12 && explore && !launcher.hidden && explore.getAttribute('aria-disabled')!=='true')explore.click();
 const loading=document.getElementById('loading-screen'),reset=document.getElementById('reset-globe-view');
 const loaded=!loading || getComputedStyle(loading).display==='none' || Number(getComputedStyle(loading).opacity)<.05;
 if(!resetDone && attempts>16 && reset && loaded){reset.click();resetDone=true;window.__relayWorldReady=true;}
 if(++attempts>120)clearInterval(timer);
},250);})();
