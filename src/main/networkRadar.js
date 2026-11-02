// Passive local inventory only: cached neighbors and OS counters, never port scans or packet capture.
const os = require('os');
const net = require('net');
const { execFile } = require('child_process');
const { parseFirewall, parseFileVault } = require('./doctor');
const { parseNetstat } = require('./panels/sources');
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
function neighbors(text) {
  const found = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /\(([^)]+)\) at ([0-9a-f:]+) on (\S+)/i.exec(line);
    if (!m || !net.isIP(m[1])) continue;
    const mac = m[2].split(':').map(n => n.padStart(2,'0')).join(':').toLowerCase();
    if (!MAC.test(mac) || ['ff:ff:ff:ff:ff:ff','00:00:00:00:00:00'].includes(mac)) continue;
    const first = parseInt(mac.slice(0,2),16); if (first & 1) continue; // multicast is not a neighboring device
    found.set(`${m[1]}:${m[3]}`, { ip:m[1], mac, interface:m[3], privateAddress:!!(first & 2) });
  }
  return [...found.values()].slice(0,256);
}
function route(text) { return { gateway: /^\s*gateway:\s*(\S+)/m.exec(text)?.[1] || null, interface: /^\s*interface:\s*(\S+)/m.exec(text)?.[1] || null }; }
function listeners(text) {
  return String(text || '').split('\n').slice(1).flatMap(line => {
    const m = /\sTCP\s+(\S+)/.exec(line), fields = line.trim().split(/\s+/);
    if (!m) return [];
    const address = m[1], port = Number(/:(\d+)$/.exec(address)?.[1]);
    return Number.isInteger(port) ? [{ process:fields[0], pid:Number(fields[1]), address, port, localOnly:/^(?:127\.|\[?::1\]?:|localhost:)/.test(address) }] : [];
  }).slice(0,128);
}
const run = (file,args) => new Promise((resolve,reject) => execFile(file,args,{timeout:2500,maxBuffer:1024*1024,encoding:'utf8'},(err,out,stderr)=>err && !(file.endsWith('/lsof') && err.code === 1 && !out && !stderr) ? reject(new Error(`${file.split('/').pop()} unavailable (${err.code || 'failed'})`)) : resolve(out)));
class NetworkRadar {
  constructor({ exec = run, interfaces = () => os.networkInterfaces(), store, now = Date.now } = {}) { Object.assign(this,{exec,interfaces,store,now}); }
  recognized() { return this.store?.get('networkRecognized') || []; }
  mark(mac, on) {
    if (!MAC.test(String(mac))) throw new Error('Choose a device from the radar.');
    const normalized=mac.toLowerCase();
    if (!this.latest?.devices.some(d => d.mac === normalized)) throw new Error('Refresh the radar and choose a current cached device.');
    const set=new Set(this.recognized());if(on)set.add(normalized);else set.delete(normalized);
    this.store.set('networkRecognized',[...set].slice(-256));return{ok:true};
  }
  async snapshot() {
    if(this.pending)return this.pending;
    this.pending=this.read().finally(()=>{this.pending=null;});return this.pending;
  }
  async read() {
    const errors=[];
    const query=async(label,file,args,empty='')=>{try{return await this.exec(file,args);}catch(e){errors.push({source:label,error:e.message});return empty;}};
    const [arp,gateway,fw,fv,open,traffic]=await Promise.all([
      query('Neighbors','/usr/sbin/arp',['-an']),query('Default route','/sbin/route',['-n','get','default']),
      query('Firewall','/usr/libexec/ApplicationFirewall/socketfilterfw',['--getglobalstate']),query('Disk encryption','/usr/bin/fdesetup',['status']),
      query('Listening services','/usr/sbin/lsof',['-nP','-iTCP','-sTCP:LISTEN']),query('Traffic','/usr/sbin/netstat',['-ib'])
    ]);
    const at=this.now(), counters=parseNetstat(traffic), elapsed=this.previous?(at-this.previous.at)/1000:0;
    const speed=!errors.some(e=>e.source==='Traffic')&&elapsed>0&&counters.inB>=this.previous.inB&&counters.outB>=this.previous.outB?{downKBs:Math.round((counters.inB-this.previous.inB)/elapsed/1024),upKBs:Math.round((counters.outB-this.previous.outB)/elapsed/1024)}:null;
    this.previous=errors.some(e=>e.source==='Traffic')?null:{...counters,at};
    const local=Object.entries(this.interfaces()).flatMap(([name,items])=>(items||[]).filter(i=>!i.internal).map(i=>({interface:name,address:i.address,family:i.family})));
    const devices=neighbors(arp).map(d=>({...d,recognized:this.recognized().includes(d.mac)}));
    const firewall=parseFirewall(fw),filevault=parseFileVault(fv),services=listeners(open);
    const warnings=[];
    if(firewall===0)warnings.push('The macOS application firewall is off. Review Firewall in System Settings.');
    if(firewall===null)warnings.push('Firewall status is unavailable; this is not a passed check.');
    if(filevault==='off')warnings.push('FileVault disk encryption is off. This is a Mac protection check, not a router test.');
    if(services.some(s=>!s.localOnly))warnings.push('Some local services listen beyond localhost. They may be reachable on permitted networks; review the service list.');
    const result={at,devices,local,route:route(gateway),firewall,filevault,services,speed,warnings,errors};this.latest=result;return result;
  }
}
module.exports={NetworkRadar,neighbors,route,listeners};
