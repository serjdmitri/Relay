const test=require('node:test'),assert=require('node:assert/strict');
const {NetworkRadar,neighbors,route,listeners}=require('../src/main/networkRadar');
const arp='? (192.168.1.1) at a:b:c:d:e:f on en0 ifscope [ethernet]\n? (192.168.1.7) at 02:11:22:33:44:55 on en0 ifscope\n? (192.168.1.8) at (incomplete) on en0\n? (224.0.0.1) at 1:0:5e:0:0:1 on en0\n? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0';
const lsof='COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 123 sam 1u IPv4 0 0t0 TCP 127.0.0.1:3000 (LISTEN)\nserver 124 sam 2u IPv6 0 0t0 TCP *:8000 (LISTEN)';
function make(over={}){let known=[];const store={get:()=>known,set:(_k,v)=>known=v};const outputs={arp,route:' gateway: 192.168.1.1\n interface: en0',socketfilterfw:'Firewall is disabled. (State = 0)',fdesetup:'FileVault is Off.',lsof,netstat:'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#1> aa:bb 10 0 10000 10 0 20000 0'};return new NetworkRadar({store,interfaces:()=>({en0:[{internal:false,address:'192.168.1.2',family:'IPv4'}],lo0:[{internal:true,address:'127.0.0.1'}]}),exec:async file=>outputs[file.split('/').pop()],...over});}
test('passive neighbors exclude multicast, broadcasts and unresolved records; normalize MACs',()=>{const list=neighbors(arp);assert.equal(list.length,2);assert.equal(list[0].mac,'0a:0b:0c:0d:0e:0f');assert.equal(list[1].privateAddress,true);assert.deepEqual(neighbors('broken'),[]);});
test('route and listening addresses separate local-only services from wider bindings',()=>{assert.equal(route('gateway: 1.2.3.4\n interface: en0').interface,'en0');assert.equal(listeners(lsof)[0].localOnly,true);assert.equal(listeners(lsof)[1].localOnly,false);assert.deepEqual(listeners(''),[]);});
test('read-only snapshot reports warnings, excludes loopback interfaces and recognition is only a label',async()=>{const r=make(),result=await r.snapshot();assert.equal(result.devices.length,2);assert.equal(result.local.length,1);assert.equal(result.firewall,0);assert.equal(result.filevault,'off');assert.equal(result.warnings.length,3);assert.equal(result.speed,null);r.mark(result.devices[0].mac,true);assert.equal((await r.snapshot()).devices[0].recognized,true);assert.throws(()=>r.mark('aa:aa:aa:aa:aa:aa',true),/current/);assert.throws(()=>r.mark('__proto__',true),/Choose/);});
test('failed sources stay unavailable rather than becoming passed or empty security checks',async()=>{const r=make({exec:async()=>{throw Error('permission denied');}}),result=await r.snapshot();assert.equal(result.errors.length,6);assert.equal(result.firewall,null);assert.equal(result.filevault,'unknown');assert.equal(result.speed,null);assert.match(result.warnings.join(' '),/unavailable/);});
test('simultaneous refresh requests share the same passive reads',async()=>{let calls=0;const r=make({exec:async()=>{calls++;await new Promise(res=>setTimeout(res,5));return '';}});await Promise.all([r.snapshot(),r.snapshot()]);assert.equal(calls,6);});
const {sweepTargets,parseBrowse,parseResolve,parseAddress,classify,bonjour}=require('../src/main/networkRadar');
test('sweep targets stay on private subnets, cap at the /24 around the Mac and skip the Mac itself',()=>{
  const t=sweepTargets({en0:[{internal:false,family:'IPv4',address:'192.168.1.2',netmask:'255.255.255.0'}],big:[{internal:false,family:'IPv4',address:'10.182.64.20',netmask:'255.255.192.0'}],pub:[{internal:false,family:'IPv4',address:'8.8.8.8',netmask:'255.255.255.0'}],lo0:[{internal:true,family:'IPv4',address:'127.0.0.1',netmask:'255.0.0.0'}],v6:[{internal:false,family:'IPv6',address:'fe80::1',netmask:'ffff::'}],small:[{internal:false,family:'IPv4',address:'172.16.5.9',netmask:'255.255.255.252'}]});
  assert.deepEqual(t.map(x=>x.interface),['en0','big','small']);
  assert.equal(t[0].ips.length,253);assert.ok(!t[0].ips.includes('192.168.1.2'));assert.ok(!t[0].ips.includes('192.168.1.0')&&!t[0].ips.includes('192.168.1.255'));
  assert.equal(t[1].ips[0],'10.182.64.1');assert.equal(t[1].ips.length,253);assert.ok(t[1].ips.every(ip=>ip.startsWith('10.182.64.')));
  assert.deepEqual(t[2].ips,['172.16.5.10']);assert.deepEqual(sweepTargets(null),[]);
});
test('Bonjour output parses into names, hosts and private addresses only',()=>{
  const b=parseBrowse("Browsing for _companion-link._tcp\nTimestamp     A/R    Flags  if Domain               Service Type         Instance Name\n10:20:00.456  Add        2   4 local.               _companion-link._tcp.  Sergey's iPhone\n10:20:00.457  Rmv        0   4 local.               _companion-link._tcp.  Gone iPad\n");
  assert.deepEqual(b,[{domain:'local.',type:'_companion-link._tcp',name:"Sergey's iPhone"}]);
  assert.deepEqual(parseResolve("Sergey's iPhone._companion-link._tcp.local. can be reached at Sergeys-iPhone.local.:49152 (interface 4)\n model=iPhone14,2 osxvers=21"),{host:'Sergeys-iPhone.local.',model:'iPhone14,2'});
  assert.equal(parseAddress('10:20:01.000  Add  2  4 Sergeys-iPhone.local.  192.168.1.23  120'),'192.168.1.23');assert.equal(parseAddress('10:20:01.000  Add  2  4 x.local.  8.8.8.8  120'),null);assert.equal(parseAddress(''),null);
  assert.equal(classify("Sergey's iPad",null),'iPad');assert.equal(classify('x','iPhone14,2'),'iPhone');assert.equal(classify('Printer',null),null);
});
test('bonjour resolves each advertised name to an address without a shell',async()=>{
  const calls=[];const run=async args=>{calls.push(args);if(args[0]==='-B')return args[1]==='_companion-link._tcp'?'10:20:00.456  Add        2   4 local.               _companion-link._tcp.  Sergey\'s iPhone\n':'';if(args[0]==='-L')return `${args[1]}._companion-link._tcp.local. can be reached at Sergeys-iPhone.local.:1 (interface 4)\n model=iPhone14,2`;return '10:20:01.000  Add  2  4 Sergeys-iPhone.local.  192.168.1.23  120';};
  const found=await bonjour({run});assert.deepEqual(found,[{ip:'192.168.1.23',name:"Sergey's iPhone",kind:'iPhone',model:'iPhone14,2',services:['_companion-link._tcp']}]);assert.ok(calls.some(c=>c[0]==='-L'&&c[1]==="Sergey's iPhone"));
});
test('scan nudges the subnet, names devices by MAC, and does not run twice at once',async()=>{
  let probed=0,browsed=0;const r=make({interfaces:()=>({en0:[{internal:false,family:'IPv4',address:'192.168.1.2',netmask:'255.255.255.0'}]}),probe:async t=>{probed+=t[0].ips.length;await new Promise(res=>setTimeout(res,5));},browse:async()=>{browsed++;return[{ip:'192.168.1.7',name:"Sergey's iPad",kind:'iPad',model:null,services:['_companion-link._tcp']},{ip:'192.168.1.99',name:'Not in the cache',kind:null,model:null,services:[]}];}});
  const [a,b]=await Promise.all([r.scan(),r.scan()]);
  assert.equal(probed,253);assert.equal(browsed,1);assert.strictEqual(a,b);
  assert.equal(a.devices.find(d=>d.ip==='192.168.1.7').name,"Sergey's iPad");assert.equal(a.devices.find(d=>d.ip==='192.168.1.1').name,undefined);
  assert.equal(a.scan.hosts,253);assert.equal(a.scan.named,2);const only=a.devices.find(d=>d.ip==='192.168.1.99');assert.equal(only.source,'bonjour');assert.equal(only.mac,null);assert.equal(a.neighborRows,2);assert.equal(a.scan.note,undefined);
  assert.equal((await r.snapshot()).devices.find(d=>d.ip==='192.168.1.7').kind,'iPad');
});
test('scan with no private network says so and failed probes do not break the radar',async()=>{
  const none=await make({interfaces:()=>({lo0:[{internal:true,family:'IPv4',address:'127.0.0.1',netmask:'255.0.0.0'}]})}).scan();assert.equal(none.scan.hosts,0);assert.match(none.scan.note,/No private/);
  const r=make({interfaces:()=>({en0:[{internal:false,family:'IPv4',address:'192.168.1.2',netmask:'255.255.255.0'}]}),probe:async()=>{throw Error('blocked');},browse:async()=>{throw Error('no dns-sd');}});
  const res=await r.scan();assert.equal(res.devices.length,2);assert.equal(res.scan.named,0);
});

test('bonjour merges one device advertised under several services and drops the MAC prefix of AirPlay audio names',async()=>{
  const run=async args=>{if(args[0]==='-B')return args[1]==='_airplay._tcp'?"10:20:00.4  Add        2   4 local.               _airplay._tcp.  Eitan's MacBook Air\n":args[1]==='_raop._tcp'?"10:20:00.4  Add        2   4 local.               _raop._tcp.  EED8D3F3C53F@Eitan's MacBook Air\n":'';if(args[0]==='-L')return `${args[1]} can be reached at Mac.local.:7000 (interface 4)\n model=${args[1].includes('@')?'':'Mac14,2'}`;return '10:20:01.0  Add  2  4 Mac.local.  10.1.2.3  120';};
  const found=await bonjour({run});assert.equal(found.length,1);assert.equal(found[0].name,"Eitan's MacBook Air");assert.equal(found[0].model,'Mac14,2');assert.deepEqual(found[0].services.sort(),['_airplay._tcp','_raop._tcp']);
});
test('a scan that finds no neighbor list still shows the devices Bonjour named, and says how to see the rest',async()=>{
  const r=make({exec:async file=>file.endsWith('/arp')?'':{route:' gateway: 10.1.1.1\n interface: en0'}[file.split('/').pop()]||'',interfaces:()=>({en0:[{internal:false,family:'IPv4',address:'10.1.1.5',netmask:'255.255.255.0'}]}),probe:async()=>{},browse:async()=>[{ip:'10.1.1.9',name:'x',kind:null,model:null,services:[]}]});
  const res=await r.scan();assert.equal(res.neighborRows,0);assert.equal(res.devices.length,1);assert.equal(res.devices[0].source,'bonjour');assert.equal(res.scan.advertising,1);assert.match(res.scan.note,/Local Network/);assert.match(res.scan.note,/quit Relay completely/);assert.match(res.scan.note,/1 device that advertise/);
});

test('devices only Bonjour can see survive a refresh, can be labelled by name, and expire after ten minutes',async()=>{
  let clock=1000000;const r=make({now:()=>clock,exec:async file=>file.endsWith('/arp')?'':'' ,interfaces:()=>({en0:[{internal:false,family:'IPv4',address:'10.1.1.5',netmask:'255.255.255.0'}]}),probe:async()=>{},browse:async()=>[{ip:'10.1.1.9',name:"Sergey's iPad",kind:'iPad',model:null,services:['_companion-link._tcp']}]});
  await r.scan();clock+=60000;const again=await r.snapshot();assert.equal(again.devices.length,1);assert.equal(again.devices[0].id,"name:sergey's ipad");
  assert.deepEqual(r.mark("name:sergey's ipad",true),{ok:true});assert.equal((await r.snapshot()).devices[0].recognized,true);
  assert.throws(()=>r.mark('name:someone else',true),/current/);assert.throws(()=>r.mark('not a device',true),/Choose/);
  clock+=11*60000;assert.equal((await r.snapshot()).devices.length,0);
});
