const { weatherWord } = require('./briefing');

function parseForecast(text) {
  const t = String(text || '').trim().replace(/^(?:(?:hey|okay|ok)\s+)?(?:jarvis|relay)[, ]+/i, '').replace(/[?.!]+$/, '');
  const m = /^(?:what(?:'s| is) (?:the )?weather|(?:show me |give me )?(?:the )?(?:weather|forecast))(?: (?:in|for|at) (.+))?$/i.exec(t);
  return m ? { place: (m[1] || '').trim() } : null;
}

async function forecast(place, { fetchFn = fetch, units = 'f', signal } = {}) {
  const [name, ...parts] = String(place || '').split(',').map((x) => x.trim());
  if (!name) return null;
  const get = async (url) => { const r = await fetchFn(url, { signal }); if (!r.ok) throw new Error('Weather service unavailable'); return r.json(); };
  const geo = await get(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: '10', language: 'en', format: 'json' })}`);
  const hint = parts.join(' ').toLowerCase();
  const p = (geo.results || []).find((x) => !hint || `${x.admin1 || ''} ${x.country || ''} ${x.country_code || ''}`.toLowerCase().includes(hint));
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  const params = new URLSearchParams({ latitude: String(p.latitude), longitude: String(p.longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', temperature_unit: units === 'c' ? 'celsius' : 'fahrenheit', timezone: 'auto', forecast_days: '7' });
  const data = await get(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = data.daily || {};
  const days = (d.time || []).map((date, i) => ({ date, high: d.temperature_2m_max?.[i], low: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i], conditions: weatherWord(d.weather_code?.[i]) })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.high) && Number.isFinite(x.low));
  if (!days.length) return null;
  return { location: [p.name, p.admin1, p.country].filter(Boolean).join(', '), units, days };
}

module.exports = { parseForecast, forecast };
