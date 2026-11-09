const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawn}=require('child_process'),readline=require('readline');
test('worker cancels at a refinement boundary and reuses the loaded model for the next reply',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-omni-worker-'));
 fs.writeFileSync(path.join(dir,'torch.py'),'float16 = None\n');
 fs.writeFileSync(path.join(dir,'soundfile.py'),"def write(path, audio, rate):\n    with open(path, 'w') as f: f.write('audio')\n");
 fs.writeFileSync(path.join(dir,'omnivoice.py'),`import time, json
class OmniVoice:
    sampling_rate = 24000
    @classmethod
    def from_pretrained(cls, *args, **kwargs): return cls()
    def register_forward_pre_hook(self, hook): self.hook = hook
    def generate(self, text, **kwargs):
        print(json.dumps({'started': text}), flush=True)
        for _ in range(100 if text == 'obsolete' else 2):
            self.hook(self, ())
            time.sleep(.005)
        return [[0]]
`);
 const child=spawn('python3',[path.resolve('src/main/tts/omni-worker.py')],{env:{...process.env,PYTHONPATH:dir},stdio:['pipe','pipe','pipe']});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true});});
 const messages=[],waiters=[];let stderr='';child.stderr.on('data',b=>stderr+=b);
 readline.createInterface({input:child.stdout}).on('line',line=>{messages.push(JSON.parse(line));for(const fn of [...waiters])fn();});
 const waitFor=pred=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout '+stderr)),5000);const check=()=>{const hit=messages.find(pred);if(hit){clearTimeout(timer);waiters.splice(waiters.indexOf(check),1);resolve(hit);}};waiters.push(check);check();});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 await waitFor(m=>m.ready);const old=path.join(dir,'old.wav');send({id:'old',text:'obsolete',path:old});await waitFor(m=>m.started==='obsolete');send({cancel:'old'});
 assert.equal((await waitFor(m=>m.id==='old')).cancelled,true);assert.equal(fs.existsSync(old),false);
 const next=path.join(dir,'next.wav');send({id:'next',text:'reply',path:next});assert.equal((await waitFor(m=>m.id==='next')).ok,true);assert.equal(fs.readFileSync(next,'utf8'),'audio');
 assert.equal(messages.filter(m=>m.ready).length,1,'model remains loaded');
});
