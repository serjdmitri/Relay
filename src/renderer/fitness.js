const $=s=>document.querySelector(s),api=window.relay;let serial=0,lastSnapshot=null;
const today=new Date();$('#day').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');$('#day').max=$('#day').value;
async function refresh(){
 const id=++serial;$('#refresh').disabled=true;$('#status').textContent='Checking Google Health…';$('#metrics').replaceChildren();
 try{
  const r=await api.fitnessAction('refresh',{email:$('#account').value||undefined,day:$('#day').value});if(id!==serial)return;
  $('#account').replaceChildren(...(r.accounts||[]).map(email=>{const o=document.createElement('option');o.value=o.textContent=email;return o;}));
  if(r.email)$('#account').value=r.email;else if((r.accounts||[]).length>1){const o=new Option('Choose an account','',true,true);$('#account').prepend(o);}
  lastSnapshot=r;renderGoal(r);
  $('#status').textContent=r.error||'Retrieved '+new Date(r.checkedAt).toLocaleString()+' · sync time is not reported';
  for(const m of r.metrics||[]){
   const card=document.createElement('article'),title=document.createElement('h2'),value=document.createElement('strong'),chart=document.createElement('div');chart.className='chart';title.textContent=m.label;
   const v=m.points.find(p=>p.date===r.day)?.value;value.textContent=v===undefined?'—':Math.round(v).toLocaleString()+' '+m.unit;card.append(title,value);const low=m.minimum?.find(p=>p.date===r.day)?.value,high=m.maximum?.find(p=>p.date===r.day)?.value;if(Number.isFinite(low)&&Number.isFinite(high)){const p=document.createElement('p');p.textContent=`Daily range ${Math.round(low)}–${Math.round(high)} bpm`;card.append(p);}
   const max=Math.max(1,...m.points.map(p=>p.value));
   for(let n=6;n>=0;n--){const date=new Date(r.day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-n);const key=date.toISOString().slice(0,10),point=m.points.find(p=>p.date===key),b=document.createElement('button');b.className='day';b.textContent=key.slice(5)+'\n'+(point?Math.round(point.value).toLocaleString():'—');b.title=key+': '+(point?point.value+' '+m.unit:'No synced data');b.style.setProperty('--fill',point?Math.max(1,point.value/max*100)+'%':'0%');b.onclick=()=>{$('#day').value=key;refresh();};chart.append(b);}
   card.append(chart);if(m.error){const p=document.createElement('p');p.textContent=m.error;card.append(p);}$('#metrics').append(card);
  }
 }catch{if(id===serial)$('#status').textContent='Could not finish. Reopen this menu and retry.';}finally{if(id===serial)$('#refresh').disabled=false;}
}
$('#refresh').onclick=refresh;$('#account').onchange=refresh;$('#day').onchange=refresh;$('#connect').onclick=()=>api.fitnessAction('settings');$('#x').onclick=()=>api.fitnessAction('close');document.addEventListener('keydown',e=>{if(e.key==='Escape')api.fitnessAction('close');});refresh();

function renderGoal(r){const goal=Number(r.goal)||10000,steps=r.metrics?.find(m=>m.unit==='steps')?.points.find(p=>p.date===r.day)?.value,known=Number.isFinite(steps),percent=known?(r.progress?.percent??Math.min(100,Math.round(steps/goal*100))):0;$('#goal').value=goal;$('#goal-ring').style.setProperty('--progress',percent+'%');$('#goal-percent').textContent=known?percent+'%':'—';$('#goal-detail').textContent=known?`${Math.round(steps).toLocaleString()} / ${goal.toLocaleString()} steps · ${r.day}${steps>=goal?' · Goal reached':''}`:'No synced steps for this date';$('#goal-ring').setAttribute('aria-valuemin','0');$('#goal-ring').setAttribute('aria-valuemax',String(goal));if(known)$('#goal-ring').setAttribute('aria-valuenow',String(Math.min(goal,steps)));else $('#goal-ring').removeAttribute('aria-valuenow');}
$('#save-goal').onclick=async()=>{try{const r=await api.fitnessAction('goal',{goal:Number($('#goal').value)});$('#goal-status').textContent=r.error||'Goal saved locally. Applied to the selected date.';if(r.ok){lastSnapshot={...(lastSnapshot||{}),goal:r.goal,progress:undefined};renderGoal(lastSnapshot);}}catch{$('#goal-status').textContent='Could not save the goal.';}};
