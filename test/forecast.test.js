const test = require('node:test');
const assert = require('node:assert/strict');
const { parseForecast, forecast } = require('../src/main/forecast');

test('weather requests preserve the requested location', () => {
  assert.deepEqual(parseForecast('Hey Jarvis, weather in Paris, France?'), { place: 'Paris, France' });
  assert.deepEqual(parseForecast('show me the forecast for London'), { place: 'London' });
  assert.deepEqual(parseForecast('what is the weather'), { place: '' });
  assert.deepEqual(parseForecast('whats the weather in Moscow'), { place: 'Moscow' });
  assert.deepEqual(parseForecast('show me a weather menu in Hollywood Florida'), { place: 'Hollywood Florida' });
  assert.deepEqual(parseForecast('make a menu with weather in Moscow Russia'), { place: 'Moscow Russia' });
  assert.equal(parseForecast('email me the weather report'), null);
});

test('forecast identifies the matching location and does not invent missing days', async () => {
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return { ok: true, json: async () => urls.length === 1 ? { results: [{ name: 'Paris', admin1: 'Texas', country: 'United States', country_code: 'US', latitude: 33, longitude: -95 }, { name: 'Paris', country: 'France', latitude: 48, longitude: 2 }] } : { daily: { time: ['2026-11-01', '2026-11-02'], weather_code: [0, 3], temperature_2m_max: [15, null], temperature_2m_min: [8, 5], precipitation_probability_max: [20, null] } } }; };
  const result = await forecast('Paris, France', { fetchFn, units: 'c' });
  assert.equal(result.location, 'Paris, France');
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].rain, 20);
  assert.match(urls[1], /latitude=48/);
  assert.match(urls[1], /forecast_days=7/);
  assert.equal(await forecast('Paris, Atlantis', { fetchFn: async () => ({ ok: true, json: async () => ({ results: [] }) }) }), null);
  assert.equal(await forecast('Russia', { fetchFn: async () => ({ ok: true, json: async () => ({ results: [{ name: 'Russia', country: 'Russia', feature_code: 'PCLI', latitude: 60, longitude: 90 }] }) }) }), null, 'a whole country needs a city');
  await assert.rejects(forecast('Paris', { fetchFn: async () => ({ ok: false }) }));
});

test('spoken city and country without a comma can correct the Moscow transcription', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.hostname.startsWith('geocoding')) return { ok: true, json: async () => ({ results: u.searchParams.get('name') === 'Moscow' ? [{ name: 'Moscow', country: 'Russia', latitude: 55, longitude: 37 }] : [] }) };
    return { ok: true, json: async () => ({ daily: { time: ['2026-11-01'], temperature_2m_max: [40], temperature_2m_min: [30] } }) };
  };
  const result = await forecast('moskow russia', { fetchFn });
  assert.equal(result.location, 'Moscow, Russia');
  assert.equal(calls[1].searchParams.get('name'), 'Moscow');
});
