const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn } = require('child_process');
const { pathProblem } = require('../drive/guard');
const { hasSymlink } = require('../drive/plan');
const ENGINE = '/Applications/FreeCAD.app/Contents/Resources/bin/python';
const LIB = '/Applications/FreeCAD.app/Contents/Resources/lib';
const WORKER = path.join(__dirname, 'stepWorker.py');
const MAX = 20 * 1024 * 1024;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const quote = p => JSON.stringify(p);
function runWorker(input, { spawnFn = spawn, engine = ENGINE } = {}) {
  const worker = input.worker;
  return new Promise((resolve, reject) => {
    // FreeCAD's bundled Python requires broad filesystem reads on macOS; its fixed worker is the only code we execute.
    // Deny network and writes outside the isolated temporary directory.
    const profile = `(version 1)(deny default)(allow file-read*)(allow process-exec (literal ${quote(engine)}))(allow process-fork)(allow sysctl-read)(allow mach-lookup)(allow file-write* (subpath ${quote(input.dir)}))(allow file-write-data (literal "/dev/null"))`;
    let out = '', done = false;
    const child = spawnFn('/usr/bin/sandbox-exec', ['-p', profile, engine, worker], { cwd: input.dir, env: { HOME: input.dir, TMPDIR: input.dir, PYTHONPATH: LIB, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: ['pipe','pipe','ignore'] });
    const finish = e => { if (done) return; done = true; clearTimeout(timer); if (e) reject(e); else { try { const m = out.match(/RELAY_RESULT (\{[^\n]*\})/); if (!m) throw Error(); resolve(JSON.parse(m[1])); } catch { reject(Error('FreeCAD did not return a usable model.')); } } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Error('STEP preview timed out.')); }, 30000);
    child.stdout.on('data', b => { out = (out + b.toString()).slice(-8192); });
    child.on('error', () => finish(Error('Could not start the isolated CAD engine.')));
    child.on('exit', code => finish(code === 0 ? null : Error('FreeCAD could not process this STEP file in the isolated preview.')));
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input));
  });
}
class StepWorkspace {
  constructor({ home = os.homedir(), now = Date.now, run = runWorker, engineAvailable = () => fs.existsSync(ENGINE) } = {}) { Object.assign(this,{home,now,run,engineAvailable}); this.previews = new Map(); }
  check(file) { const p=path.resolve(String(file || '').replace(/^~(?=\/)/,this.home)); const reason=pathProblem(p,this.home); if(reason || !/\.(?:step|stp)$/i.test(p) || hasSymlink(p,fs,this.home)) throw Error(reason || 'Choose a STEP file without symbolic links.'); return p; }
  async preview({file,axis,factor}) {
    const source=this.check(file); if(!['x','y','z'].includes(axis)||typeof factor!=='number'||!Number.isFinite(factor)||factor<0.1||factor>10)throw Error('Choose axis x, y, or z and a scale from 0.1 to 10.');
    if(!this.engineAvailable())throw Error('Install FreeCAD to preview STEP changes.');const st=fs.lstatSync(source);if(!st.isFile()||st.size>MAX)throw Error('Choose a STEP file under 20 MB.');const bytes=fs.readFileSync(source);
    const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'relay-step-'))), input=path.join(dir,'source.step'), step=path.join(dir,'preview.step'), stl=path.join(dir,'preview.stl'), worker=path.join(dir,'worker.py');
    try { fs.writeFileSync(input,bytes,{mode:0o600,flag:'wx'}); fs.writeFileSync(worker,fs.readFileSync(WORKER),{mode:0o600,flag:'wx'}); const sizes=await this.run({dir,input,step,stl,worker,axis,factor});
      for(const p of [step,stl]) { const f=fs.lstatSync(p); if(!f.isFile()||f.size<84||f.size>MAX)throw Error('The CAD output is invalid or too large.'); }
      const id=crypto.randomUUID();this.previews.set(id,{source,hash:hash(bytes),step:fs.readFileSync(step),stl:fs.readFileSync(stl),sizes,axis,factor,at:this.now()});while(this.previews.size>3)this.previews.delete(this.previews.keys().next().value);
      return {id,source,axis,factor,...sizes};
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  }
  get(id) { const p=this.previews.get(id);if(!p||this.now()-p.at>600000)throw Error('STEP preview expired. Preview again.');return p; }
  summary(id) { try {const p=this.get(id);return `Save a new STEP copy of ${path.basename(p.source)}, scaled ${p.factor} along ${p.axis.toUpperCase()}? The whole model changes; its original remains untouched.`;}catch{return null;} }
  save(id) {const p=this.get(id);this.previews.delete(id);this.check(p.source);if(hash(fs.readFileSync(p.source))!==p.hash)throw Error('The original changed. Preview again.');const ext=path.extname(p.source),base=path.basename(p.source,ext),dir=path.dirname(p.source);for(let n=1;n<=100;n++){const target=path.join(dir,`${base} - Relay edit${n===1?'':` ${n}`}${ext}`);this.check(target);try{fs.writeFileSync(target,p.step,{flag:'wx',mode:0o600});return target;}catch(e){if(e.code!=='EEXIST')throw e;}}throw Error('No free copy name.');}
}
module.exports={StepWorkspace,runWorker,ENGINE,MAX};
