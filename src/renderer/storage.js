const $ = id => document.getElementById(id);
const size = n => n >= 1e12 ? (n/1e12).toFixed(1)+' TB' : n>=1e9 ? (n/1e9).toFixed(1)+' GB' : n>=1e6 ? (n/1e6).toFixed(1)+' MB' : n>=1e3 ? (n/1e3).toFixed(1)+' KB' : n+' B';
let current=null, shown=100, poll=null;const selected=new Set();let viewId='types';
const status = text => { $('status').textContent=text; };
const action = async (name,value) => { const result=await relay.storageAction(name,value);if(result?.error)throw Error(result.error);return result; };
const button = (label,run,cls='') => {const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=()=>Promise.resolve().then(run).catch(e=>status(e.message));return b;};
function map(){
  $('map').replaceChildren();if(!current)return;
  const byType=current.node.id==='types';$('map').classList.toggle('category-map',byType);
  if(byType&&current.children.length){
    const max=Math.max(...current.children.map(n=>n.bytes),1);
    for(const item of current.children){const b=button(item.name,()=>show(item.id));const detail=document.createElement('span');detail.textContent=`${size(item.bytes)} · ${item.count} ${item.count===1?'file':'files'}`;const bar=document.createElement('i');bar.style.width=Math.max(1,item.bytes/max*100)+'%';b.append(detail,bar);$('map').append(b);}return;
  }
  const items=current.children.length?current.children:current.node.file?[current.node]:[];
  const blocks=storageLayout(items,$('map').clientWidth,$('map').clientHeight);
  if(!blocks.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=current.node.reason||'No measurable files in this folder.';$('map').append(empty);}
  for(const block of blocks){const b=button(block.name,()=>show(block.id));b.title=`${block.name} · ${size(block.bytes)}`;b.setAttribute('aria-label',b.title);Object.assign(b.style,{left:block.x+'px',top:block.y+'px',width:block.width+'px',height:block.height+'px'});if(block.width<60||block.height<34)b.textContent='';else{const detail=document.createElement('span');detail.textContent=size(block.bytes)+(block.count?` · ${block.count} files`:'');b.append(detail);}$('map').append(b);}
}
function list(){
  $('items').replaceChildren();for(const item of current.children.slice(0,shown)){
    const row=document.createElement('div');row.className='item';
    if(item.file){const select=document.createElement('input');select.type='checkbox';select.checked=selected.has(item.id);select.disabled=!item.trashable;select.setAttribute('aria-label','Select '+item.name);select.title=item.trashable?'Select for confirmed Trash':'Protected or read-only item';select.onchange=async()=>{if(select.checked)selected.add(item.id);else selected.delete(item.id);await selection();};row.append(select);}
    const name=button((item.directory?'▸ ':'')+item.name,()=>show(item.id),'name');
    if(item.reason){const note=document.createElement('small');note.textContent=item.reason;name.append(note);}
    const bytes=document.createElement('span');bytes.className='size';bytes.textContent=size(item.bytes);row.append(name,bytes);if(!String(item.id).startsWith('category:'))row.append(button('Finder',()=>action('reveal',item.id),'reveal'));$('items').append(row);
  }$('more').hidden=current.children.length<=shown;
}
async function show(id='types'){
  const data=await action('view',id);if(!data.node)return;
  current=data;viewId=id;shown=100;$('total').textContent=size(data.node.bytes);$('path').textContent=data.node.path;$('finder').disabled=!!data.node.virtual;
  $('crumbs').replaceChildren(...data.crumbs.map(c=>button(c.name,()=>show(c.id))));
  $('capacity').textContent=data.capacity?`Volume capacity ${size(data.capacity.total)} · Available ${size(data.capacity.available)} · Used ${size(data.capacity.used)}. APFS volumes may share space; this is separate from scanned file totals.`:'';
  $('warning').textContent=data.node.reason|| (data.partial?`Incomplete scan · ${data.unreadable} unreadable · ${data.skipped} excluded. Limits: 20,000 entries, 24 levels, 15 seconds.`:'');
  status(`${data.files} files measured · ${new Date(data.scannedAt).toLocaleTimeString()} · ${data.partial?'partial results':'scan finished'}`);map();list();
}
async function selection(){try{await action('select',[...selected]);$('trash').textContent=`Trash selected (${selected.size})`;$('trash').disabled=!selected.size;}catch(e){selected.clear();$('trash').disabled=true;status(e.message);}}
$('types').onclick=()=>show('types').catch(e=>status(e.message));$('folders').onclick=()=>show('0').catch(e=>status(e.message));
relay.onStorageChanged(async r=>{selected.clear();await selection();await show(viewId);status(r.cancelled?'Cancelled. No files moved.':`${r.count} files moved to Trash. ${r.failed?.length||0} could not be moved.`);});
$('trash').onclick=()=>action('trash').catch(e=>status(e.message));
function busy(on){$('scan').disabled=on||!$('roots').value;$('roots').disabled=on;$('cancel').hidden=!on;}
async function tick(){
  try{const result=await action('status');if(result.status==='scanning')status(`Scanning locally… ${result.files||0} files, ${result.entries||0} entries checked.`);
    else{clearInterval(poll);poll=null;busy(false);if(result.status==='ready')await show();else status(result.error||'Scan cancelled. Start a new scan when ready.');}
  }catch(e){clearInterval(poll);poll=null;busy(false);status(e.message);}
}
$('scan').onclick=async()=>{try{selected.clear();await selection();current=null;$('map').replaceChildren();$('items').replaceChildren();$('crumbs').replaceChildren();$('finder').disabled=true;$('total').textContent='—';$('path').textContent='';$('warning').textContent='';await action('start',$('roots').value);busy(true);status('Scanning locally…');clearInterval(poll);poll=setInterval(tick,400);}catch(e){status(e.message);busy(false);}};
$('cancel').onclick=async()=>{await action('cancel');await tick();};
$('finder').onclick=()=>action('reveal',current?.node.id).catch(e=>status(e.message));
let choosing = false;
async function choose() {
  if (choosing) return;
  choosing = true;
  try {
    const data = await action('choose');
    if (data.cancelled) { status('Choose a folder when ready to build your storage map.'); return; }
    await roots();
    if (data.selectedRoot) $('roots').value = data.selectedRoot;
    await $('scan').onclick();
  } catch (e) { status(e.message); } finally { choosing = false; }
}
$('settings').onclick=choose;
$('x').onclick=()=>action('close');$('more').onclick=()=>{shown+=100;list();};
new ResizeObserver(map).observe($('map'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')action('close');});
async function roots(){try{const old=$('roots').value,data=await action('roots');$('roots').replaceChildren();if(data.computer){const o=document.createElement('option');o.value='computer';o.textContent='Entire computer (read-only)';$('roots').append(o);}for(const r of data.roots){const o=document.createElement('option');o.value=r.id;o.textContent=r.path+(r.error?' · '+r.error:'');o.disabled=!r.readable;$('roots').append(o);}const available=[...$('roots').options].filter(o=>!o.disabled);$('roots').value=available.some(o=>o.value===old)?old:available.some(o=>o.value===data.preferredRoot)?data.preferredRoot:available.find(o=>o.value!=='computer')?.value||available[0]?.value||'';busy(!!poll);if(!available.length)status('Choose a folder to build your storage map. Folder access is read-only.');}catch(e){status(e.message);}}
async function requestedScan() {
  await roots();
  if (poll) return; // repeated requests reveal the scan already running
  if ($('roots').value) await $('scan').onclick(); else await choose();
}
relay.onStorageScanRequested(requestedScan);
window.addEventListener('focus',roots);
if (new URLSearchParams(location.search).get('scan') === '1') requestedScan(); else roots();
