// The private answer window's page. It only draws what the main process sends: the latest answers, a "listening" chip, or the hidden-window test.
const stack = document.getElementById('stack');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const cards = new Map(); // id -> element
let chip = null;

function lines(text) {
  const rows = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { first: rows.find((l) => !l.startsWith('- ')) || '', bullets: rows.filter((l) => l.startsWith('- ')).map((l) => l.slice(2)) };
}

function draw(s) {
  let el = cards.get(s.id);
  if (!el) {
    el = mk('div', 'a');
    cards.set(s.id, el);
    stack.prepend(el);
    [...cards.keys()].slice(0, -3).forEach((k) => { cards.get(k).remove(); cards.delete(k); }); // the last three stay
  }
  [...cards.entries()].forEach(([k, e]) => e.classList.toggle('old', k !== s.id));
  const { first, bullets } = lines(s.text);
  el.replaceChildren(mk('div', 'q', s.question || ''));
  el.append(mk('div', 'ans', first));
  if (bullets.length) { const ul = mk('ul'); for (const b of bullets.slice(0, 4)) ul.append(mk('li', '', b)); el.append(ul); }
  const foot = mk('div', 'foot');
  if (s.stage === 'thinking' || (s.stage === 'quick' && !first)) { foot.className = 'foot dots'; foot.append(mk('span'), mk('span'), mk('span')); }
  else if (s.stage === 'checking') foot.append(mk('span', '', 'Checking online…'));
  else if (s.stage === 'checked') {
    const fix = s.verdict === 'correction' || s.verdict === 'new';
    foot.className = `foot ${fix ? 'fix' : 'ok'}`;
    foot.append(mk('b', '', s.verdict === 'correction' ? 'Correction' : s.verdict === 'new' ? 'Also' : '✓ Checked online'));
    if (s.sources && s.sources.length) foot.append(mk('span', '', s.sources.join(' · ')));
    if (fix && s.extra) foot.append(mk('div', 'extra', s.extra));
  } else if (s.stage === 'unchecked') foot.append(mk('span', '', 'Could not check online'));
  else if (s.stage === 'error') { foot.append(mk('span', '', '')); }
  if (foot.childNodes.length) el.append(foot);
}

relay.onAssist((kind, p) => {
  if (kind === 'answer') draw(p);
  else if (kind === 'status') {
    chip?.remove();
    chip = mk('div', 'status');
    chip.append(mk('i'), mk('span', '', p.text));
    stack.append(chip);
    setTimeout(() => chip && chip.remove(), 6000);
  } else if (kind === 'test') {
    stack.replaceChildren();
    cards.clear();
    const t = mk('div', 'test');
    t.append(mk('h1', '', 'PRIVATE WINDOW TEST'), mk('p', '', p.hidden ? 'Start a screen share or recording now. If you can see this box there, it is NOT hidden on this Mac.' : 'Hiding is switched off in Settings, so this will show on screen shares.'));
    stack.append(t);
    setTimeout(() => t.remove(), 20000);
  } else if (kind === 'clear') { stack.replaceChildren(); cards.clear(); chip = null; }
});
