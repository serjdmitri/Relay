const $=s=>document.querySelector(s),api=window.relay;let serial=0;
const today=new Date();$('#day').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');$('#day').max=$('#day').value;
async function refresh(){
 const id=++serial;$('#refresh').disabled=true;$('#status').textContent='Checking Google Health…';$('#metrics').replaceChildren();
 try{
  const r=await api.fitnessAction('refresh',{email:$('#account').value||undefined,day:$('#day').value});if(id!==serial)return;
  $('#account').replaceChildren(...(r.accounts||[]).map(email=>{const o=document.createElement('option');o.value=o.textContent=email;return o;}));
  if(r.email)$('#account').value=r.email;else if((r.accounts||[]).length>1){const o=new Option('Choose an account','',true,true);$('#account').prepend(o);}
  $('#status').textContent=r.error||'Retrieved '+new Date(r.checkedAt).toLocaleString()+' · sync time is not reported';
  for(const m of r.metrics||[]){
   const card=document.createElement('article'),title=document.createElement('h2'),value=document.createElement('strong'),chart=document.createElement('div');chart.className='chart';title.textContent=m.label;
   const v=m.points.find(p=>p.date===r.day)?.value;value.textContent=v===undefined?'—':Math.round(v).toLocaleString()+' '+m.unit;card.append(title,value);
   const max=Math.max(1,...m.points.map(p=>p.value));
   for(let n=6;n>=0;n--){const date=new Date(r.day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-n);const key=date.toISOString().slice(0,10),point=m.points.find(p=>p.date===key),b=document.createElement('button');b.className='day';b.textContent=key.slice(5)+'\n'+(point?Math.round(point.value).toLocaleString():'—');b.title=key+': '+(point?point.value+' '+m.unit:'No synced data');b.style.setProperty('--fill',point?Math.max(1,point.value/max*100)+'%':'0%');b.onclick=()=>{$('#day').value=key;refresh();};chart.append(b);}
   card.append(chart);if(m.error){const p=document.createElement('p');p.textContent=m.error;card.append(p);}$('#metrics').append(card);
  }
 }catch{if(id===serial)$('#status').textContent='Could not finish. Reopen this menu and retry.';}finally{if(id===serial)$('#refresh').disabled=false;}
}
$('#refresh').onclick=refresh;$('#account').onchange=refresh;$('#day').onchange=refresh;$('#connect').onclick=()=>api.fitnessAction('settings');$('#x').onclick=()=>api.fitnessAction('close');document.addEventListener('keydown',e=>{if(e.key==='Escape')api.fitnessAction('close');});refresh();
