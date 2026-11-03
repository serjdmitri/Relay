// Wait for actual engine readiness, not an arbitrary multi-second delay.
(()=>{let attempts=0,resetDone=false;const timer=setInterval(()=>{
 const launcher=document.getElementById('first-run-launcher'),dismiss=launcher?.querySelector('[data-first-run-dismiss]');
 if(dismiss&&!launcher.hidden)dismiss.click();
 const engine=window.__godsEyeView,loading=document.getElementById('loading-screen'),reset=document.getElementById('reset-globe-view');
 const loaded=!loading||getComputedStyle(loading).display==='none'||Number(getComputedStyle(loading).opacity)<.05;
 if(!resetDone&&engine?.viewer?.scene&&engine.voiceCommands?.runner&&reset&&loaded){const camera=engine.viewer.camera;camera.cancelFlight?.();const height=camera.positionCartographic?.height;if(Number.isFinite(height)&&height<18000000)camera.zoomOut(18000000-height);resetDone=true;window.__relayWorldReady=true;window.__relayWorldReadyAt=performance.now();}
 if(++attempts>300)clearInterval(timer);
},100);})();
