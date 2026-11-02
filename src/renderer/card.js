/* global relay */
// Draws an answer card. Everything the model wrote goes in with textContent; the picture is a data: URL made by Relay.
const root = document.getElementById('card');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

function render(c) {
  root.replaceChildren();
  root.classList.toggle('weather', c.kind === 'weather');
  if (c.kind === 'weather') { renderWeather(c); return; }
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

function renderWeather(c) {
  const close = mk('button', 'weather-close', '×');
  close.setAttribute('aria-label', 'Close forecast');
  close.onclick = () => relay.cardClose();
  root.append(close);
  const box = mk('div', 'weather-inner');
  box.append(mk('div', 'weather-kicker', 'WEATHER  /  OPEN-METEO'));
  box.append(mk('h1', 'weather-title', c.location || 'Forecast'));
  box.append(mk('div', 'weather-source', `Open-Meteo · Retrieved ${c.fetchedAt ? new Date(c.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'time unavailable'} · Conditions ${c.current?.time?.replace('T', ' ') || 'time unavailable'} (location time)`));
  const main = mk('div', 'weather-main');
  const now = c.current || {};
  const hero = mk('div', 'weather-hero');
  hero.append(mk('div', 'weather-symbol', weatherSymbol(now.code)));
  const temp = mk('div', 'weather-tempbox');
  temp.append(mk('div', 'weather-temp', Number.isFinite(now.temperature) ? `${Math.round(now.temperature)}°` : '—'));
  temp.append(mk('div', 'weather-condition', now.conditions || 'Current conditions unavailable'));
  temp.append(mk('div', 'weather-feels', Number.isFinite(now.feels) ? `Feels like ${Math.round(now.feels)}°${String(c.units || '').toUpperCase()}` : 'Feels like unavailable'));
  hero.append(temp); main.append(hero);
  const metrics = mk('div', 'weather-metrics');
  const time = (v) => typeof v === 'string' && v.includes('T') ? v.split('T')[1] : '—';
  for (const [label, value] of [['HUMIDITY', Number.isFinite(now.humidity) ? `${now.humidity}%` : '—'], ['WIND', Number.isFinite(now.wind) ? `${Math.round(now.wind)} ${c.units === 'c' ? 'km/h' : 'mph'}` : '—'], ['UV MAX', Number.isFinite(now.uv) ? String(now.uv) : '—'], ['SUNRISE', time(now.sunrise)], ['SUNSET', time(now.sunset)]]) {
    const el = mk('div', 'weather-metric'); el.append(mk('span', '', label), mk('strong', '', value)); metrics.append(el);
  }
  main.append(metrics); box.append(main);
  const hourly = (c.hourly || []).filter((h) => Number.isFinite(h.temperature));
  if (hourly.length > 1) {
    const graph = mk('div', 'weather-graph');
    graph.append(mk('div', 'weather-graph-label', 'NEXT HOURS  /  TEMPERATURE'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 700 70'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Hourly temperature trend');
    const vals = hourly.map((h) => h.temperature); const min = Math.min(...vals); const range = Math.max(1, Math.max(...vals) - min);
    const points = hourly.map((h, i) => `${i * 700 / (hourly.length - 1)},${60 - (h.temperature - min) / range * 45}`).join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#40d8ff'); line.setAttribute('stroke-width', '3');
    svg.append(line); graph.append(svg);
    const labels = mk('div', 'weather-hour-labels');
    for (const h of [hourly[0], hourly[Math.floor(hourly.length / 2)], hourly.at(-1)]) labels.append(mk('span', '', `${String(h.time).split('T')[1] || ''} · ${Math.round(h.temperature)}°`));
    graph.append(labels); box.append(graph);
  }
  const strip = mk('div', 'weather-days');
  (c.days || []).forEach((d, i) => {
    const day = mk('div', `weather-day${i === 0 ? ' today' : ''}`);
    const date = new Date(`${d.date}T12:00:00Z`);
    const label = i === 0 ? 'TODAY' : Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase() : d.date;
    day.append(mk('div', 'weather-day-label', label), mk('div', 'weather-day-icon', weatherSymbol(d.code)), mk('div', 'weather-day-condition', d.conditions || 'Unavailable'), mk('div', 'weather-day-temps', `${Math.round(d.high)}°  /  ${Math.round(d.low)}°`), mk('div', 'weather-day-rain', Number.isFinite(d.rain) ? `${d.rain}% precipitation` : 'Precipitation —'));
    strip.append(day);
  });
  box.append(strip); root.append(box);
}

function weatherSymbol(code) {
  if (code === 0 || code === 1) return '☀';
  if (code === 2) return '⛅';
  if ([3, 45, 48].includes(code)) return '☁';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄';
  if ([95, 96, 99].includes(code)) return 'ϟ';
  return Number.isFinite(code) ? '☂' : '—';
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
