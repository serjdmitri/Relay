// Visual-only bridge into the local engine. Never exposes Relay's privileged bridge.
(()=>{
 if(window.__relayWorldLayout)return;
 window.__relayWorldLayout=true;
 const send=data=>window.postMessage({type:'relay-world-layout',...data},location.origin);
 const toolbar=document.createElement('nav');toolbar.id='relay-world-toolbar';toolbar.setAttribute('aria-label','Jarvis world controls');
 for(const [action,label,glyph] of [['settings','World settings','⚙'],['close','Close world','×']]){
  const button=document.createElement('button');button.textContent=glyph;button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>send({action});toolbar.append(button);
 }
 document.body.append(toolbar);
 const rails=[['left','Layers'],['right','Context']].map(([side,label])=>{
  const button=document.createElement('button');button.className='relay-edge relay-edge-'+side;button.textContent=label;button.setAttribute('aria-label','Show '+label.toLowerCase()+' controls');
  button.onpointerenter=()=>document.body.classList.add('relay-'+side+'-open');button.onfocus=button.onpointerenter;
  button.onclick=()=>document.body.classList.toggle('relay-'+side+'-open');document.body.append(button);return button;
 });
 window.__relaySetWorldControls=mode=>{document.body.dataset.relayControls=mode==='pinned'?'pinned':'hover';};
 window.__relaySetWorldControls('hover');
 let dragging=false,lastFill=-1,lastLayout;
 addEventListener('pointerdown',()=>{dragging=true;if(lastLayout)send({...lastLayout,dragging});});
 for(const event of ['pointerup','pointercancel','blur'])addEventListener(event,()=>{dragging=false;if(lastLayout)send({...lastLayout,dragging});});
 const visible=element=>{const s=getComputedStyle(element),r=element.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>.05&&r.width>0&&r.height>0;};
 const bounds=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 addEventListener('pointermove',event=>{
  for(const [side,selector] of [['left','#left-panel-stack'],['right','#right-context-rail']]){
   const panel=document.querySelector(selector),r=panel?.getBoundingClientRect();
   if(r && !dragging && (side==='left'?event.clientX>Math.max(420,r.right+60):event.clientX<Math.min(innerWidth-420,r.left-60)))document.body.classList.remove('relay-'+side+'-open');
  }
 });
 const timer=setInterval(()=>{
  const viewer=window.__godsEyeView?.viewer,scene=viewer?.scene,height=viewer?.camera?.positionCartographic?.height;
  if(!scene || !Number.isFinite(height))return;
  // Smoothly fill the desktop as the camera approaches Earth; globe stays in the same scene.
  const fill=Math.max(0,Math.min(1,(14000000-height)/6000000)),orbit=fill<1;
  if(Math.abs(fill-lastFill)>.005){document.documentElement.style.setProperty('--world-fill',fill);scene.backgroundColor=scene.backgroundColor.withAlpha(fill);scene.requestRender();lastFill=fill;}
  document.body.classList.toggle('relay-orbit',orbit);
  if(scene.skyBox)scene.skyBox.show=false;
  if(scene.sun)scene.sun.show=false;
  if(scene.moon)scene.moon.show=false;
  const fovy=viewer.camera.frustum.fovy||Math.PI/3;
  const radius=innerHeight/2*Math.tan(Math.asin(Math.min(1,6378137/(height+6378137))))/Math.tan(fovy/2)+20;
  const center=scene.cartesianToCanvasCoordinates({x:0,y:0,z:0})||{x:innerWidth/2,y:innerHeight/2};
  const rects=[...document.querySelectorAll('#relay-world-toolbar,.relay-edge,#left-panel-stack > *,#right-context-rail > *,#command-dock,#corner-actions,.cesium-viewer-bottom,#key-setup-panel,#first-run-launcher')].filter(visible).slice(0,40).map(bounds);
  lastLayout={action:'layout',orbit,fill,globe:{x:center.x,y:center.y,radius},rects,dragging};send(lastLayout);
 },120);
 addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();void 0;
