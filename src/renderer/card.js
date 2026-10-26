/* global relay */
// Draws an answer card. Everything the model wrote goes in with textContent; the picture is a data: URL made by Relay.
const root = document.getElementById('card');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function render(c) {
  root.replaceChildren();
  root.classList.toggle('noimg', !(c.kind === 'entity' && c.image));
  if (c.kind === 'entity' && c.image) {
    const hero = mk('div', 'hero');
    const img = document.createElement('img');
    img.src = c.image;
    img.alt = '';
    hero.append(img);
    if (c.credit) hero.append(mk('div', 'credit', c.credit));
    root.append(hero);
  }
  const x = mk('div', 'x', '×');
  x.onclick = () => relay.cardClose();
  root.append(x);
  const body = mk('div', 'body');
  body.append(mk('h1', '', c.title));
  if (c.subtitle) body.append(mk('div', 'sub', c.subtitle));
  if (c.summary) body.append(mk('div', 'sum', c.summary));
  if (c.facts?.length) {
    const dl = mk('dl', 'facts');
    for (const f of c.facts) { dl.append(mk('dt', '', f.label)); dl.append(mk('dd', '', f.value)); }
    body.append(dl);
  }
  if (c.items?.length) {
    const list = mk('div', 'list');
    for (const it of c.items) {
      const row = mk('div', `item${it.url ? ' go' : ''}`);
      const th = mk('div', 'thumb');
      if (it.image) th.style.backgroundImage = `url("${it.image}")`;
      const t = mk('div', 'it');
      t.append(mk('b', '', it.title));
      if (it.subtitle) t.append(mk('span', '', it.subtitle));
      if (it.note) t.append(mk('i', '', it.note));
      row.append(th, t);
      if (it.url) row.onclick = () => relay.cardOpen(it.url);
      list.append(row);
    }
    body.append(list);
  }
  if (c.links?.length) {
    const ls = mk('div', 'links');
    for (const l of c.links) { const a = mk('div', 'link', l.label); a.onclick = () => relay.cardOpen(l.url); ls.append(a); }
    body.append(ls);
  }
  root.append(body);
}

// scrollHeight is the card's full height even when the window is still too short to show it all
const measure = () => relay.cardSize(Math.max(root.scrollHeight, root.offsetHeight));
relay.onCard((m, card) => {
  if (m === 'show') {
    document.body.classList.remove('hide');
    render(card);
    requestAnimationFrame(() => { measure(); requestAnimationFrame(() => document.body.classList.add('show')); });
    for (const img of root.querySelectorAll('img')) img.onload = measure;
  } else {
    document.body.classList.add('hide');
    setTimeout(() => document.body.classList.remove('show'), 460);
  }
});
root.addEventListener('mouseenter', () => relay.cardHover(true));
root.addEventListener('mouseleave', () => relay.cardHover(false));
