// A failure is believed for a while. When something Relay depends on (an online voice, a model) fails, it rests for a time that depends on why,
// and requests skip it until then, so a dead one costs one wait instead of one wait per request.
//
//   quota (429, out of credits)  5 minutes: quotas refill
//   timeout / unavailable (5xx)  30 minutes: an outage outlasts a retry
//   missing / no access (404, 401, 403)  6 hours: a bad key or name does not fix itself in a minute

const MIN = 60000;
const REST = { quota: 5 * MIN, down: 30 * MIN, missing: 360 * MIN };

// What kind of failure was it? Takes an HTTP status, an Error or a message.
function classify(err) {
  const status = Number(err?.status ?? err?.statusCode ?? (typeof err === 'number' ? err : NaN));
  const text = String(err?.message ?? err ?? '');
  if (status === 429 || /quota|rate.?limit|too many requests|out of (?:credits|usage)|\b429\b/i.test(text)) return 'quota';
  if ([401, 403, 404].includes(status) || /\b(?:401|403|404)\b|not found|rejected the key|did not accept|no access|not allowed/i.test(text)) return 'missing';
  if ([500, 502, 503, 504].includes(status) || /timed? ?out|timeout|deadline|unavailable|overloaded|\b50[0234]\b|could not reach|network/i.test(text)) return 'down';
  return null; // something else (a bad request, a bug): not worth resting a rung for
}

class Ladder {
  // load(): saved { name: untilMs }; save(obj): keep it, so a restart does not forget
  constructor({ now = Date.now, load = () => ({}), save = () => {} } = {}) {
    this.now = now;
    this.save = save;
    this.until = { ...(load() || {}) };
  }

  resting(name) { return (this.until[name] || 0) > this.now(); }

  // The first of the names (best first) that is not resting; the last one is returned when all are, so there is always an answer.
  pick(names) { return names.find((n) => !this.resting(n)) ?? names[names.length - 1]; }

  // Records a failure. Returns the kind, or null when it was not the kind that rests a rung.
  fail(name, err) {
    const kind = classify(err);
    if (!kind) return null;
    this.until[name] = this.now() + REST[kind];
    this.prune();
    this.save({ ...this.until });
    return kind;
  }

  ok(name) { if (this.until[name]) { delete this.until[name]; this.save({ ...this.until }); } }

  prune() { const t = this.now(); for (const k of Object.keys(this.until)) if (this.until[k] <= t) delete this.until[k]; }

  // For Doctor and the settings page: [{ name, minutes }] still resting.
  report() { const t = this.now(); return Object.entries(this.until).filter(([, u]) => u > t).map(([name, u]) => ({ name, minutes: Math.ceil((u - t) / MIN) })); }
}

module.exports = { Ladder, classify, REST };
