const { weatherWord } = require('./briefing');

function parseForecast(text) {
  let t = String(text || '').trim().replace(/^(?:(?:hey|okay|ok)\s+)?(?:jarvis|relay)[, ]+/i, '').replace(/[?.!]+$/, '');
  const unit = /\s+in (celsius|centigrade|fahrenheit)$/i.exec(t);
  if (unit) t = t.slice(0, unit.index);
  const m = /^(?:what(?:'s|s| is) (?:the )?weather|(?:(?:show|give|make) me |(?:open|show|make) )?(?:(?:a|the) )?(?:(?:weather|forecast)(?: (?:menu|panel|card))?|(?:menu|panel|card) (?:of|for|with) (?:the )?(?:weather|forecast)))(?: (?:in|for|at) (.+))?$/i.exec(t);
  if (m?.[1]?.includes(' and ')) return null; // multiple cities use the shared model tool, once per city
  return m ? { place: (m[1] || '').trim(), ...(unit ? { units: /^f/i.test(unit[1]) ? 'f' : 'c' } : {}) } : null;
}

async function forecast(place, { fetchFn = fetch, units = 'f', signal } = {}) {
  const [name, ...parts] = String(place || '').split(',').map((x) => x.trim());
  if (!name) return null;
  const get = async (url) => { const r = await fetchFn(url, { signal }); if (!r.ok) throw new Error('Weather service unavailable'); return r.json(); };
  const searches = new Map();
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const search = async (city, hint, exact) => {
    // Common speech-to-text spelling; never silently replace arbitrary city names.
    const normalized = /^moskow$/i.test(city) ? 'Moscow' : city;
    if (!searches.has(normalized)) searches.set(normalized, get(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: normalized, count: '10', language: 'en', format: 'json' })}`));
    const geo = await searches.get(normalized);
    return (geo.results || []).find((x) => (!exact || fold(x.name) === fold(normalized)) && (!hint || fold(`${x.admin1 || ''} ${x.country || ''} ${x.country_code || ''}`).includes(fold(hint))));
  };
  let p = await search(name, parts.join(' '), false);
  // Speech may put the region before or after the city. Try bounded, exact
  // city/region pairs concurrently; never choose an unrelated Hollywood.
  if (!p) {
    const words = name.split(/\s+/), candidates = [];
    if (parts.length) candidates.push([parts.join(' '), name]);
    else for (let i = words.length - 1; i > 0 && candidates.length < 12; i--) {
      const left = words.slice(0, i).join(' '), right = words.slice(i).join(' ');
      candidates.push([left, right], [right, left]);
    }
    p = (await Promise.all(candidates.map(([city, hint]) => search(city, hint, true)))).find(Boolean);
  }
  if (p?.feature_code === 'PCLI') return { needsCity: true, country: p.name };
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  const params = new URLSearchParams({ latitude: String(p.latitude), longitude: String(p.longitude), current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code', hourly: 'temperature_2m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max', temperature_unit: units === 'c' ? 'celsius' : 'fahrenheit', wind_speed_unit: units === 'c' ? 'kmh' : 'mph', timezone: 'auto', forecast_days: '7' });
  const data = await get(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = data.daily || {};
  const days = (d.time || []).map((date, i) => ({ date, code: d.weather_code?.[i], high: d.temperature_2m_max?.[i], low: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i], conditions: weatherWord(d.weather_code?.[i]) })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.high) && Number.isFinite(x.low));
  if (!days.length) return null;
  const current = data.current || {};
  const h = data.hourly || {};
  const hourly = (h.time || []).map((time, i) => ({ time, temperature: h.temperature_2m?.[i] })).filter((x) => x.time >= String(current.time || '') && Number.isFinite(x.temperature)).slice(0, 12);
  return { location: [...new Set([p.name, p.admin1, p.country].filter(Boolean))].join(', '), units, days, fetchedAt: new Date().toISOString(), current: { temperature: current.temperature_2m, feels: current.apparent_temperature, humidity: current.relative_humidity_2m, wind: current.wind_speed_10m, code: current.weather_code, conditions: weatherWord(current.weather_code), time: current.time, sunrise: d.sunrise?.[0], sunset: d.sunset?.[0], uv: d.uv_index_max?.[0] }, hourly };
}

module.exports = { parseForecast, forecast };
