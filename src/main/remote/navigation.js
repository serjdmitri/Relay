// Online route preview. No model calls, credential forwarding, disk history or automatic retries.
const DEFAULTS={search:'https://photon.komoot.io/api/',route:'https://valhalla1.openstreetmap.de/route',style:'https://tiles.openfreemap.org/styles/dark'};
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
function endpoint(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Map providers need HTTPS URLs without credentials or query strings.');return u.href;}
function decodeShape(shape){
 if(shape?.type==='LineString')return shape.coordinates;
 if(typeof shape!=='string'||shape.length>300000)throw Error('Map route geometry is invalid.');
 let i=0,lat=0,lon=0;const points=[];
 const delta=()=>{let value=0,shift=0,byte;do{if(i>=shape.length||shift>30)throw Error('Map route geometry is invalid.');byte=shape.charCodeAt(i++)-63;if(byte<0||byte>63)throw Error('Map route geometry is invalid.');value+=(byte&31)*2**shift;shift+=5;}while(byte>=32);return value%2?-(value+1)/2:value/2;};
 while(i<shape.length){lat+=delta();lon+=delta();points.push([lon/1e6,lat/1e6]);if(points.length>50000)throw Error('Map route geometry is too large.');}
 return points;
}
class NavigationService{
 constructor({fetchImpl=fetch,getConfig=()=>({}),isPrivate=()=>false,now=Date.now}={}){Object.assign(this,{fetch:fetchImpl,getConfig,isPrivate,now});this.cache=new Map();this.last=-Infinity;this.busy=false;}
 config(){if(this.isPrivate())throw Error('Online maps are disabled in local/private mode.');const cfg=this.getConfig()||{};return Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,endpoint(cfg[k]||v)]));}
 async request(url,options={}){
  if(this.busy||this.now()-this.last<1100)throw Error('Please wait a moment before another map search or route.');
  this.busy=true;this.last=this.now();
  try{const r=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000),headers:{'user-agent':'RelayNavigation/1.0 (+https://github.com/serjdmitri/Relay)','accept':'application/json',...options.headers}});if(!r.ok)throw Error('Map provider is unavailable. Try again later or use Apple Maps.');if(Number(r.headers.get('content-length'))>2000000)throw Error('Map response is too large.');let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>2000000)throw Error('Map response is too large.');chunks.push(Buffer.from(chunk));}if(this.isPrivate())throw Error('Map requests stopped in local/private mode.');return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch(e){if(e.message?.startsWith('Map '))throw e;throw Error('Map provider could not finish. Check the connection and retry.');}finally{this.busy=false;}
 }
 async search(query,near){const cfg=this.config(),q=String(query||'').trim();if(!q||q.length>200)throw Error('Enter a place name, up to 200 characters.');if(near!==undefined&&!point(near))throw Error('Invalid starting coordinates.');const key=JSON.stringify([cfg.search,q.toLowerCase(),near]);const cached=this.cache.get(key);if(cached&&this.now()-cached.at<300000)return cached.items;
  const u=new URL(cfg.search);u.searchParams.set('q',q);u.searchParams.set('limit','6');if(near){u.searchParams.set('lon',near[0]);u.searchParams.set('lat',near[1]);}
  const data=await this.request(u.href);if(!Array.isArray(data.features))throw Error('Map search returned an invalid result.');
  const items=data.features.slice(0,6).filter(f=>point(f.geometry?.coordinates)).map(f=>{const p=f.properties||{};return{coordinates:f.geometry.coordinates,label:[p.name,[p.housenumber,p.street].filter(Boolean).join(' '),p.city||p.town,p.state,p.country].filter(Boolean).map(v=>String(v).slice(0,160)).join(', ').slice(0,400)};}).filter(p=>p.label);
  if(this.cache.size>=32)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:this.now(),items});return items;
 }
 async route(from,to,mode){const cfg=this.config();if(!point(from)||!point(to)||!['driving','walking'].includes(mode))throw Error('Choose a valid starting point, destination and travel mode.');
  const data=await this.request(cfg.route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({locations:[from,to].map(([lon,lat])=>({lon,lat})),costing:mode==='walking'?'pedestrian':'auto',units:'kilometers',language:'en-US',shape_format:'polyline6'})});
  const trip=data.trip,leg=trip?.legs?.[0],coordinates=decodeShape(leg?.shape),summary=trip?.summary;
  if(!summary||!Number.isFinite(summary.time)||summary.time<0||!Number.isFinite(summary.length)||summary.length<0||!Array.isArray(coordinates)||coordinates.length<2||coordinates.length>50000||!coordinates.every(point))throw Error('No usable route was returned. Try another place or travel mode.');
  return{coordinates,seconds:summary.time,km:summary.length,steps:(Array.isArray(leg.maneuvers)?leg.maneuvers:[]).slice(0,200).map(s=>({text:String(s.instruction||'').slice(0,500),km:Number.isFinite(s.length)?s.length:0}))};
 }
}
module.exports={NavigationService,DEFAULTS,point,endpoint,decodeShape};
