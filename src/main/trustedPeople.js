// Named local face profiles. Only metadata is public; face vectors stay encrypted at rest.
const { sealTemplates, openTemplates } = require('./ownerGuard');
const { randomUUID } = require('crypto');
class TrustedPeople {
  constructor({store, encrypt, decrypt, authenticate, changed=()=>{}, now=Date.now}) { Object.assign(this,{store,encrypt,decrypt,authenticate,changed,now}); this.busy=false; }
  records() { const r=this.store.get('trustedFaces'); return Array.isArray(r)?r.slice(0,8):[]; }
  list() { return this.records().map(({id,name,face})=>({id,name,at:face?.at})); }
  templates() { return this.records().flatMap(r=>openTemplates(r.face,this.decrypt).slice(0,12)); }
  async authorize() { if(this.busy) throw Error('Finish the current authentication first.'); this.busy=true; try { if(!await this.authenticate()) throw Error('Mac owner authentication was cancelled or unavailable.'); } finally { this.busy=false; } }
  name(value) { const name=String(value||'').trim(); if(!name || name.length>40 || /[\x00-\x1f]/.test(name)) throw Error('Enter a name of 1–40 characters.'); if(this.records().some(r=>r.name.toLowerCase()===name.toLowerCase())) throw Error('That person is already enrolled.'); if(this.records().length>=8) throw Error('Remove a profile before adding another (maximum eight).'); return name; }
  save(name, templates) { name=this.name(name); if(!Array.isArray(templates)||templates.length<4||templates.length>12||templates.some(t=>!Array.isArray(t)||t.length!==128||!t.every(Number.isFinite))) throw Error('Face enrollment is incomplete.'); const profile={id:randomUUID(),name,face:sealTemplates(templates,this.encrypt,this.now())}; this.store.set('trustedFaces',[...this.records(),profile]); this.changed(); return profile.id; }
  async remove(id) { await this.authorize(); if(!this.records().some(r=>r.id===id)) throw Error('Profile not found.'); this.store.set('trustedFaces',this.records().filter(r=>r.id!==id)); this.changed(); }
}
module.exports={TrustedPeople};
