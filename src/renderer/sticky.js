// One sticky note's page. Its id is in the address; the text is fetched from Relay and every change is sent back (after a short pause in typing).
const id = new URLSearchParams(location.search).get('id') || '';
const t = document.getElementById('t');
let timer = 0;
let last = '';
relay.stickyGet(id).then((s) => {
  if (!s) return;
  document.body.className = s.color || 'yellow';
  t.value = s.text || '';
  last = t.value;
});
relay.onSticky((m, d) => {
  if (m === 'text' && d !== t.value && document.activeElement !== t) { t.value = d; last = d; }
  else if (m === 'color') document.body.className = d;
});
t.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => { if (t.value !== last) { last = t.value; relay.stickyText(id, t.value); } }, 500);
});
addEventListener('blur', () => { clearTimeout(timer); if (t.value !== last) { last = t.value; relay.stickyText(id, t.value); } });
document.getElementById('x').onclick = () => relay.stickyClose(id);
