const cur = document.getElementById('cur');
const lab = document.getElementById('lab');
window.relay.onOverlayPoint(({ x, y, label }) => {
  cur.style.transform = `translate(${x}px, ${y}px)`;
  lab.style.display = label ? 'block' : 'none';
  lab.textContent = label || '';
});
