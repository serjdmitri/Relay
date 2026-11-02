// Binary treemap: largest blocks remain usable when the panel is resized.
function storageLayout(items, width, height) {
  const result = [];
  const split = (list, x, y, w, h) => {
    if (!list.length) return;
    if (list.length === 1) { result.push({ ...list[0], x, y, width:w, height:h }); return; }
    const total = list.reduce((n,item)=>n+item.bytes,0); let sum=0,cut=0;
    while(cut<list.length-1 && sum<total/2) sum+=list[cut++].bytes;
    const ratio=sum/total;
    if(w>=h){split(list.slice(0,cut),x,y,w*ratio,h);split(list.slice(cut),x+w*ratio,y,w*(1-ratio),h);}
    else{split(list.slice(0,cut),x,y,w,h*ratio);split(list.slice(cut),x,y+h*ratio,w,h*(1-ratio));}
  };
  split(items.filter(i=>i.bytes>0).slice(0,30),0,0,width,height);return result;
}
if(typeof module!=='undefined')module.exports={storageLayout};
