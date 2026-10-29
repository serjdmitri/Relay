// A self-contained, offline calculator for a Relay panel. No evaluation of code or external access.
const HTML = `
<style>body{font:16px -apple-system;color:#e8f9ff;margin:0}#out{width:100%;box-sizing:border-box;background:#07121b;color:white;border:1px solid #386273;border-radius:7px;text-align:right;font-size:22px;padding:8px;margin-bottom:7px}#keys{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}button{border:1px solid #315a6a;background:#132a38;color:white;border-radius:6px;font-size:16px;padding:8px;cursor:pointer}button:hover{background:#214455}</style>
<input id="out" aria-label="Calculator display" value="0" readonly><div id="keys"></div>
<script>
let current='0', saved=null, op=null, fresh=false; const out=document.getElementById('out');
function display(){out.value=current} function apply(){if(saved===null||!op)return;const n=Number(current);const r=op==='+'?saved+n:op==='−'?saved-n:op==='×'?saved*n:n===0?NaN:saved/n;current=Number.isFinite(r)?String(Number(r.toPrecision(12))):'Error';saved=null;op=null;fresh=true}
for(const key of ['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','C','+','=']){const b=document.createElement('button');b.textContent=key;b.onclick=()=>{if(key==='C'){current='0';saved=null;op=null;fresh=false}else if('0123456789.'.includes(key)){if(fresh||current==='Error'){current='0';fresh=false}if(key==='.'&&!current.includes('.'))current+='.';else if(key!=='.')current=current==='0'?key:current+key}else if(key==='='){apply()}else{if(saved!==null&&!fresh)apply();saved=Number(current);op=key;fresh=true}display()};document.getElementById('keys').append(b)}
</script>`;
module.exports = { HTML };
