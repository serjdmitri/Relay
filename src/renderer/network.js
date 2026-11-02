const $=id=>document.getElementById(id);let data=null,selected=null,busy=false;const title=d=>d.name||d.ip;
const action=async(name,value)=>{const r=await relay.networkAction(name,value);if(r.error)throw Error(r.error);return r;};
const para=text=>{const p=document.createElement('p');p.textContent=text;return p;};
function detail(device){selected=device.id;$('detail').hidden=false;$('detail').replaceChildren(para(`${device.name?device.name+' · ':''}${device.ip} · ${device.mac||'MAC address not visible to Relay'}${device.interface?' · '+device.interface:''}`),...(device.kind||device.services?.length?[para(`${device.kind?device.kind+' · ':''}${device.services?.length?'Advertises '+device.services.join(', '):''}`)]:[]),para(!device.mac?'Found by its Bonjour name, not by the neighbor list. The name is chosen by the device and can be changed by anyone.':device.privateAddress?'This MAC uses a private/local address; it can change and does not establish identity.':'A MAC address can be spoofed; recognition is only your label.'));
 const button=document.createElement('button');button.textContent=device.recognized?'Remove recognized label':'Mark recognized';button.onclick=async()=>{try{await action('recognize',{mac:device.id,on:!device.recognized});await refresh();}catch(e){$('status').textContent=e.message;}};$('detail').append(button);
 document.querySelectorAll('.device-dot').forEach(b=>b.classList.toggle('selected',b.dataset.id===selected));}
function render(){
 $('count').textContent=data.devices.length;$('speed').textContent=data.speed?`↓ ${data.speed.downKBs} / ↑ ${data.speed.upKBs} KB/s`:'Measuring…';
 $('gateway').textContent=data.route.gateway?`${data.route.gateway} · ${data.route.interface}`:'Unavailable';
 $('security').textContent=`Firewall: ${data.firewall===null?'unknown':data.firewall===0?'off':'on'} · FileVault: ${data.filevault}`;
 $('warnings').replaceChildren(...data.warnings.map(para));$('errors').replaceChildren(...data.errors.map(e=>para(`${e.source}: ${e.error}`)));
 $('services').replaceChildren(...data.services.map(s=>para(`${s.process} · port ${s.port} · ${s.localOnly?'localhost only':'beyond localhost'}`)));
 if(!data.services.length)$('services').append(para(data.errors.some(e=>e.source==='Listening services')?'Service list unavailable.':'No visible listening TCP services.'));
 $('interfaces').replaceChildren(...data.local.map(i=>para(`${i.interface} · ${i.family} · ${i.address}`)));
 $('devices').replaceChildren();document.querySelectorAll('.device-dot').forEach(e=>e.remove());
 for(const [i,device]of data.devices.entries()){
   const row=document.createElement('div');row.className='item';const label=document.createElement('button');label.className='name';label.textContent=`${i+1}. ${device.name?`${device.name} · ${device.ip}`:device.ip}${device.kind?` · ${device.kind}`:''} · ${device.mac?'':' · by name'} · ${device.recognized?'recognized':'unreviewed'}`;label.onclick=()=>detail(device);row.append(label);$('devices').append(row);
   if(i<48){const angle=i*2.39996,radius=22+(i%4)*6,button=document.createElement('button');button.className='device-dot';button.dataset.id=device.id;button.textContent=i+1;button.title=`${title(device)} · ${device.ip}`;button.style.left=(50+Math.cos(angle)*radius)+'%';button.style.top=(50+Math.sin(angle)*radius)+'%';button.onclick=()=>detail(device);$('radar').append(button);}
 }
 if(!data.devices.length)$('devices').append(para(data.errors.some(e=>e.source==='Neighbors')?'Neighbor inventory unavailable.':'No devices seen yet. Press Scan network to wake the devices on your Wi-Fi. This does not mean there are no other devices.'));
 const current=data.devices.find(d=>d.id===selected);if(current)detail(current);else $('detail').hidden=true;
 $('stamp').textContent='Checked '+new Date(data.at).toLocaleTimeString();$('status').textContent=data.errors.length?`${data.errors.length} checks unavailable; review details below.`:'Local checks finished. Wi-Fi encryption, router settings and internet exposure were not audited.';
}
async function refresh(){if(busy)return;busy=true;$('refresh').disabled=true;$('scan').disabled=true;try{data=await action('refresh');render();}catch(e){$('status').textContent=e.message;}finally{busy=false;$('refresh').disabled=false;$('scan').disabled=false;}}
async function scan(){if(busy)return;busy=true;$('refresh').disabled=true;$('scan').disabled=true;$('status').textContent='Scanning your network… this takes a few seconds.';try{data=await action('scan');render();const s=data.scan;$('status').textContent=!s||!s.hosts||s.note?(s?.note||'Nothing to scan.'):`Scan finished: ${data.devices.length} device${data.devices.length===1?'':'s'} found, ${s.named} named. Phones and tablets that are asleep, on another network or hidden by the router can still be missing.`;}catch(e){$('status').textContent=e.message;}finally{busy=false;$('refresh').disabled=false;$('scan').disabled=false;}}
$('refresh').onclick=refresh;$('scan').onclick=scan;$('x').onclick=()=>action('close');document.addEventListener('keydown',e=>{if(e.key==='Escape')action('close');});
const timer=setInterval(refresh,10000);window.addEventListener('beforeunload',()=>clearInterval(timer));refresh();
