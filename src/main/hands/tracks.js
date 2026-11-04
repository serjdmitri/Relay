// Assign detector results to stable cursor slots. Handedness is only a hint:
// several people can present the same hand and the detector can relabel one.
const MAX_DISTANCE = 0.35;
const LABEL_PENALTY = 0.08;
const MISSING_FRAMES = 5;

class HandTracks {
  constructor(count = 2) { this.count = Math.max(1, Math.min(6, count)); this.reset(); }

  update(hands) {
    const input = (hands || []).filter((h) => h && h.score !== 0 && Number.isFinite(h.x) && Number.isFinite(h.y)).slice(0, this.count);
    // Bounded dynamic programming: six hands use at most 6×64 states.
    const memo=new Map();
    const visit=(slot,mask)=>{
      if(slot===this.count)return{count:0,cost:0,assignments:[]};
      const key=slot+':'+mask;if(memo.has(key))return memo.get(key);
      const skip=visit(slot+1,mask);let best={...skip,assignments:[-1,...skip.assignments]};
      const previous=this.slots[slot];
      if(previous)for(let i=0;i<input.length;i++){
        if(mask&(1<<i))continue;const hand=input[i],distance=Math.hypot(previous.x-hand.x,previous.y-hand.y);if(distance>MAX_DISTANCE)continue;
        const v=this.velocity[slot],gap=Math.min(this.missing[slot]+1,2),predicted=Math.hypot(previous.x+v.x*gap-hand.x,previous.y+v.y*gap-hand.y);
        const tail=visit(slot+1,mask|(1<<i)),cost=tail.cost+predicted+(previous.handed&&hand.handed&&previous.handed!==hand.handed?LABEL_PENALTY:0),count=tail.count+1;
        if(count>best.count||(count===best.count&&cost<best.cost))best={count,cost,assignments:[i,...tail.assignments]};
      }
      memo.set(key,best);return best;
    };
    const best=visit(0,0);
    const output = Array(this.count).fill(null);
    const used = new Set();
    for (let i = 0; i < this.count; i++) {
      const j = best.assignments[i];
      if (j >= 0) { const previous=this.slots[i],gap=this.missing[i]+1;this.velocity[i]={x:(input[j].x-previous.x)/gap,y:(input[j].y-previous.y)/gap};output[i] = input[j]; used.add(j); this.slots[i] = input[j]; this.missing[i] = 0; }
      else if (this.slots[i] && ++this.missing[i] > MISSING_FRAMES) { this.slots[i] = null; this.missing[i] = 0; }
    }
    for (let j = 0; j < input.length; j++) {
      if (used.has(j)) continue;
      let slot = output.findIndex((h, i) => !h && !this.slots[i]);
      if (slot < 0) break;
      this.velocity[slot]={x:0,y:0};this.epochs[slot]++;output[slot] = input[j]; this.slots[slot] = input[j]; this.missing[slot] = 0;
    }
    return output;
  }

  reset() { this.velocity=Array.from({length:this.count},()=>({x:0,y:0}));this.epochs=Array(this.count).fill(0);this.slots = Array(this.count).fill(null); this.missing = Array(this.count).fill(0); }
}
module.exports = { HandTracks };
