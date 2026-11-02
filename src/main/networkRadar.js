// Passive local inventory by default: cached neighbors and OS counters. Scan network is opt-in and only touches your own
// private subnet: one 1-byte UDP packet per address (so devices answer ARP) plus Bonjour browsing for device names.
// Never port scans or packet capture.
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const { execFile, spawn } = require('child_process');
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
const PRIVATE = ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip);
const ipNum = ip => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const numIp = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
// The addresses to nudge: the /24 around each private IPv4 address (or the real network when it is smaller), never more than 254 per interface.
function sweepTargets(interfaces) {
  const out = [];
  for (const [name, items] of Object.entries(interfaces || {})) for (const i of items || []) {
    if (i.internal || i.family !== 'IPv4' || !i.netmask || !net.isIPv4(i.address) || !net.isIPv4(i.netmask) || !PRIVATE(i.address)) continue;
    const addr = ipNum(i.address), mask = ipNum(i.netmask) > 0xffffff00 ? ipNum(i.netmask) : 0xffffff00;
    const first = ((addr & mask) >>> 0) + 1, last = ((((addr & mask) >>> 0) | (~mask >>> 0)) >>> 0) - 1, ips = [];
    for (let n = first; n <= last && ips.length < 254; n++) if (n !== addr) ips.push(numIp(n));
    if (ips.length) out.push({ interface: name, address: i.address, ips });
  }
  return out;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// Sends one byte to the UDP discard port of every target. The Mac has to ask "who has this address?" first, and phones and
// tablets answer that even when they ignore ping, which fills the neighbor cache that arp -an reads.
async function sweep(targets, { settle = 1500 } = {}) {
  for (const t of targets) {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => {});
    try {
      await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind({ address: t.address, port: 0 }, resolve); });
      for (let i = 0; i < t.ips.length; i += 32) {
        for (const ip of t.ips.slice(i, i + 32)) socket.send(Buffer.alloc(1), 9, ip, () => {});
        await wait(10);
      }
      await wait(settle);
    } catch { /* this interface could not be used; others still run */ } finally { try { socket.close(); } catch { /* already closed */ } }
  }
}
const BONJOUR = ['_companion-link._tcp', '_airplay._tcp', '_apple-mobdev2._tcp', '_device-info._tcp', '_homekit._tcp', '_googlecast._tcp', '_raop._tcp'];
// dns-sd never exits on its own, so it is stopped at the timeout, or a moment after the answer we wanted has arrived.
const timed = (args, ms, until) => new Promise(resolve => {
  let out = '', early = null;
  const p = spawn('/usr/bin/dns-sd', args, { stdio: ['ignore', 'pipe', 'ignore'] }), t = setTimeout(() => p.kill(), ms);
  p.stdout.on('data', d => { out += d; if (out.length > 262144) p.kill(); else if (until && !early && until.test(out)) early = setTimeout(() => p.kill(), 250); });
  p.on('error', () => { clearTimeout(t); clearTimeout(early); resolve(''); });
  p.on('close', () => { clearTimeout(t); clearTimeout(early); resolve(out); });
});
function parseBrowse(text) {
  const found = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\S+\s+Add\s+\d+\s+\d+\s+(\S+)\s+(_[\w-]+\._(?:tcp|udp))\.\s+(.+?)\s*$/.exec(line);
    if (m) found.push({ domain: m[1], type: m[2], name: m[3] });
  }
  return found;
}
const parseResolve = text => { const m = /can be reached at (\S+?):\d+/.exec(String(text || '')); return { host: m ? m[1] : null, model: /\bmodel=(\S+)/.exec(String(text || ''))?.[1] || null }; };
const parseAddress = text => { const m = /\sAdd\s+\S+\s+\d+\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+\d+/.exec(String(text || '')); return m && PRIVATE(m[1]) ? m[1] : null; };
function classify(name, model) {
  const t = `${model || ''} ${name || ''}`;
  if (/iPhone/i.test(t)) return 'iPhone';
  if (/iPad/i.test(t)) return 'iPad';
  if (/Watch/i.test(t)) return 'Apple Watch';
  if (/AppleTV|Apple TV/i.test(t)) return 'Apple TV';
  if (/AudioAccessory|HomePod/i.test(t)) return 'HomePod';
  if (/Mac|iMac/i.test(t)) return 'Mac';
  if (/Chromecast|Google|Nest/i.test(t)) return 'Google device';
  if (/Echo|Alexa|Fire/i.test(t)) return 'Amazon device';
  if (/Samsung|Galaxy|Pixel|Android/i.test(t)) return 'Android';
  return null;
}
// Names the devices that advertise themselves with Bonjour (the same service Apple devices use to find each other). Returns [{ip,name,kind,model,services}].
async function bonjour({ run = timed, limit = 40 } = {}) {
  const seen = new Map();
  for (const out of await Promise.all(BONJOUR.map(type => run(['-B', type, 'local'], 2500)))) for (const f of parseBrowse(out)) if (seen.size < limit) seen.set(`${f.name}|${f.type}`, f);
  const byName = new Map();
  for (const f of seen.values()) byName.set(f.name, [...(byName.get(f.name) || []), f.type]);
  const items = [...byName].map(([name, services]) => ({ name, type: services[0], services }));
  const byIp = new Map();
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++], { host, model } = parseResolve(await run(['-L', it.name, it.type, 'local'], 1800, /can be reached at/));
      const ip = host ? parseAddress(await run(['-G', 'v4', host], 1500, /\sAdd\s/)) : null;
      if (!ip) continue;
      const name = it.name.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(Number(d))).replace(/^[0-9A-F]{12}@/, '');   // AirPlay audio names start with the MAC
      const have = byIp.get(ip);
      byIp.set(ip, { ip, name: have?.name || name, kind: have?.kind || classify(it.name, model), model: have?.model || model, services: [...new Set([...(have?.services || []), ...it.services])] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, items.length) }, worker));
  return [...byIp.values()];
}
const run = (file,args) => new Promise((resolve,reject) => execFile(file,args,{timeout:2500,maxBuffer:1024*1024,encoding:'utf8'},(err,out,stderr)=>err && !(file.endsWith('/lsof') && err.code === 1 && !out && !stderr) ? reject(new Error(`${file.split('/').pop()} unavailable (${err.code || 'failed'})`)) : resolve(out)));
class NetworkRadar {
  constructor({ exec = run, interfaces = () => os.networkInterfaces(), store, now = Date.now, probe = sweep, browse = bonjour } = {}) { Object.assign(this,{exec,interfaces,store,now,probe,browse,names:new Map(),seen:new Map(),lastScan:null}); }
  recognized() { return this.store?.get('networkRecognized') || []; }
  mark(id, on) {
    const key=String(id||'').toLowerCase();
    if (!MAC.test(key) && !/^name:.{1,120}$/.test(key)) throw new Error('Choose a device from the radar.');
    if (!this.latest?.devices.some(d => d.id === key)) throw new Error('Refresh the radar and choose a current device.');
    const set=new Set(this.recognized());if(on)set.add(key);else set.delete(key);
    this.store.set('networkRecognized',[...set].slice(-256));return{ok:true};
  }
  // Opt-in, started by the Scan network button: wake the devices on your own subnet, name the ones that advertise themselves, then read the cache.
  async scan() {
    if(this.scanning)return this.scanning;
    this.scanning=this.discover().finally(()=>{this.scanning=null;});return this.scanning;
  }
  async discover() {
    const at=this.now(),targets=sweepTargets(this.interfaces()),hosts=targets.reduce((n,t)=>n+t.ips.length,0);
    if(!hosts){this.lastScan={at,hosts:0,named:0,note:'No private IPv4 network was found to scan.'};return this.snapshot();}
    const [,found]=await Promise.all([this.probe(targets).catch(()=>{}),Promise.resolve(this.browse()).catch(()=>[])]);
    await this.pending?.catch(()=>{});
    let result=await this.snapshot();
    for(const f of found||[]){
      const d=result.devices.find(x=>x.ip===f.ip&&x.mac),entry={name:f.name,kind:f.kind,model:f.model,services:f.services};
      if(d)this.names.set(d.mac,entry);else this.seen.set(f.ip,{...entry,ip:f.ip,at});
    }
    result=await this.snapshot();
    const advertising=(found||[]).length,named=result.devices.filter(d=>d.name).length;
    this.lastScan={at,hosts,named,advertising,neighborRows:result.neighborRows};
    if(!result.neighborRows)this.lastScan.note=`The scan ran, but macOS showed Relay no neighbor list${advertising?`, so only the ${advertising} device${advertising===1?'':'s'} that advertise by name ${advertising===1?'is':'are'} shown`:''}. To see the rest: open System Settings > Privacy & Security > Local Network, turn Relay on, quit Relay completely, open it again and scan.`;
    result.scan=this.lastScan;
    return result;
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
    const rows=neighbors(arp),known=this.recognized();
    const devices=rows.map(d=>({...d,id:d.mac,...this.names.get(d.mac),recognized:known.includes(d.mac)}));
    for(const [ip,f] of this.seen){
      if(f.at<at-600000){this.seen.delete(ip);continue;}   // ten minutes, then it has to be seen again
      if(devices.some(d=>d.ip===ip))continue;
      const id=`name:${f.name}`.toLowerCase().slice(0,125);
      devices.push({ip,mac:null,id,interface:null,privateAddress:false,source:'bonjour',name:f.name,kind:f.kind,model:f.model,services:f.services,recognized:known.includes(id)});
    }
    const firewall=parseFirewall(fw),filevault=parseFileVault(fv),services=listeners(open);
    const warnings=[];
    if(firewall===0)warnings.push('The macOS application firewall is off. Review Firewall in System Settings.');
    if(firewall===null)warnings.push('Firewall status is unavailable; this is not a passed check.');
    if(filevault==='off')warnings.push('FileVault disk encryption is off. This is a Mac protection check, not a router test.');
    if(services.some(s=>!s.localOnly))warnings.push('Some local services listen beyond localhost. They may be reachable on permitted networks; review the service list.');
    const result={at,devices,local,route:route(gateway),firewall,filevault,services,speed,warnings,errors,neighborRows:rows.length,scan:this.lastScan};this.latest=result;return result;
  }
}
module.exports={NetworkRadar,neighbors,route,listeners,sweepTargets,parseBrowse,parseResolve,parseAddress,classify,bonjour};
