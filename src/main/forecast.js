const { weatherWord } = require('./briefing');

function parseForecast(text) {
  const t = String(text || '').trim().replace(/^(?:(?:hey|okay|ok)\s+)?(?:jarvis|relay)[, ]+/i, '').replace(/[?.!]+$/, '');
  const m = /^(?:what(?:'s|s| is) (?:the )?weather|(?:(?:show|give|make) me |(?:open|show|make) )?(?:(?:a|the) )?(?:(?:weather|forecast)(?: (?:menu|panel|card))?|(?:menu|panel|card) (?:of|for|with) (?:the )?(?:weather|forecast)))(?: (?:in|for|at) (.+))?$/i.exec(t);
  return m ? { place: (m[1] || '').trim() } : null;
}

async function forecast(place, { fetchFn = fetch, units = 'f', signal } = {}) {
  const [name, ...parts] = String(place || '').split(',').map((x) => x.trim());
  if (!name) return null;
  const get = async (url) => { const r = await fetchFn(url, { signal }); if (!r.ok) throw new Error('Weather service unavailable'); return r.json(); };
  const search = async (city, hint, exact) => {
    // Common speech-to-text spelling; never silently replace arbitrary city names.
    const normalized = /^moskow$/i.test(city) ? 'Moscow' : city;
    const geo = await get(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: normalized, count: '10', language: 'en', format: 'json' })}`);
    return (geo.results || []).find((x) => (!exact || String(x.name || '').toLowerCase() === normalized.toLowerCase()) && (!hint || `${x.admin1 || ''} ${x.country || ''} ${x.country_code || ''}`.toLowerCase().includes(hint.toLowerCase())));
  };
  let p = await search(name, parts.join(' '), false);
  // Dictation usually omits commas: try city followed by its region or country,
  // longest city name first, and require an exact city and region match.
  if (!p && !parts.length) {
    const words = name.split(/\s+/);
    for (let i = words.length - 1; i > 0 && !p; i--) p = await search(words.slice(0, i).join(' '), words.slice(i).join(' '), true);
  }
  if (!p || p.feature_code === 'PCLI' || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  const params = new URLSearchParams({ latitude: String(p.latitude), longitude: String(p.longitude), current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code', hourly: 'temperature_2m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max', temperature_unit: units === 'c' ? 'celsius' : 'fahrenheit', wind_speed_unit: units === 'c' ? 'kmh' : 'mph', timezone: 'auto', forecast_days: '7' });
  const data = await get(`https://api.open-meteo.com/v1/forecast?${params}`);
  const d = data.daily || {};
  const days = (d.time || []).map((date, i) => ({ date, code: d.weather_code?.[i], high: d.temperature_2m_max?.[i], low: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i], conditions: weatherWord(d.weather_code?.[i]) })).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.high) && Number.isFinite(x.low));
  if (!days.length) return null;
  const current = data.current || {};
  const h = data.hourly || {};
  const hourly = (h.time || []).map((time, i) => ({ time, temperature: h.temperature_2m?.[i] })).filter((x) => x.time >= String(current.time || '') && Number.isFinite(x.temperature)).slice(0, 12);
  return { location: [...new Set([p.name, p.admin1, p.country].filter(Boolean))].join(', '), units, days, current: { temperature: current.temperature_2m, feels: current.apparent_temperature, humidity: current.relative_humidity_2m, wind: current.wind_speed_10m, code: current.weather_code, conditions: weatherWord(current.weather_code), time: current.time, sunrise: d.sunrise?.[0], sunset: d.sunset?.[0], uv: d.uv_index_max?.[0] }, hourly };
}

module.exports = { parseForecast, forecast };
