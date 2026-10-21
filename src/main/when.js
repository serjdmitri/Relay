// Spoken durations and times: "an hour and a half", "tomorrow at 9", "next monday at 10am".
// Pure functions; parseWhen takes `now` so it can be tested.

const UNITS = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400 };
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const FILLER = new Set(['at', 'on', 'the', 'of', 'by', 'for', 'around', 'about', 'next', 'this', 'in', 'a', 'an', 'to', 'and', 'oclock', "o'clock", 'clock', 'sharp', 'please', 'it']);

const unitKey = (u) => u.replace(/s$/, '');

// One spoken number: "5", "1.5", "ten", "twenty five". Returns [value, tokensUsed] or null.
function numberAt(tokens, i) {
  const t = tokens[i];
  if (t === undefined) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return [parseFloat(t), 1];
  if (t in TENS) {
    const nx = tokens[i + 1];
    if (nx && nx in SMALL && SMALL[nx] < 10 && SMALL[nx] > 0) return [TENS[t] + SMALL[nx], 2];
    return [TENS[t], 1];
  }
  if (t in SMALL) return [SMALL[t], 1];
  if (t === 'a' || t === 'an') return [1, 1];
  return null;
}

// Seconds, or null when the text is not a duration.
function parseDuration(text) {
  const tokens = String(text).toLowerCase().replace(/[,.]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const joined = tokens.join(' ');
  if (/^(?:a )?half (?:an? )?hour$/.test(joined)) return 1800;
  if (/^(?:a )?quarter (?:of )?(?:an? )?hour$/.test(joined)) return 900;
  let total = 0;
  let lastMult = 0;
  let pending = null;
  let used = false;
  let article = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'and') continue;
    // "... and a half" after a unit: another half of that unit
    if ((t === 'a' || t === 'an') && tokens[i + 1] === 'half' && lastMult && pending === null) {
      total += lastMult / 2;
      i++;
      continue;
    }
    if (t === 'half') {
      // "half an hour" inside a longer phrase, or "and a half" after a unit
      if (lastMult && pending === null) { total += lastMult / 2; continue; }
      pending = 0.5;
      continue;
    }
    const n = numberAt(tokens, i);
    // "two and a half minutes"
    if (n && tokens[i + n[1]] === 'and' && (tokens[i + n[1] + 1] === 'a' || tokens[i + n[1] + 1] === 'an') && tokens[i + n[1] + 2] === 'half') {
      pending = (pending ?? 0) + n[0] + 0.5;
      i += n[1] + 2;
      continue;
    }
    if (n && !(UNITS[unitKey(tokens[i + n[1]] || '')] === undefined && !(tokens[i + n[1]] === 'half'))) {
      if (tokens[i + n[1]] === 'half') { pending = n[0]; i += n[1] - 1; continue; }
      pending = (pending ?? 0) + n[0];
      i += n[1] - 1;
      continue;
    }
    const mult = UNITS[unitKey(t)];
    if (mult !== undefined) {
      if (pending === null && !article) return null; // "minutes" on its own is not a duration
      article = false;
      total += (pending === null ? 1 : pending) * mult;
      lastMult = mult;
      pending = null;
      used = true;
      continue;
    }
    if (t === 'a' || t === 'an') { article = true; continue; }
    return null;
  }
  if (pending !== null || !used) return null;
  return Math.round(total);
}

function atTime(base, h, m) {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// "5", "5:30", "17:30", "noon", "five thirty": returns { h, m, ampm } or null.
function parseClock(s) {
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    const h = +m[1];
    if (h > 24 || (m[2] && +m[2] > 59)) return null;
    return { h, m: m[2] ? +m[2] : 0, ampm: m[3] || null, explicit: !!(m[3] || m[2] || h > 12 || h === 0) };
  }
  if (s === 'noon' || s === 'midday') return { h: 12, m: 0, ampm: 'pm', explicit: true };
  if (s === 'midnight') return { h: 0, m: 0, ampm: 'am', explicit: true };
  const words = s.split(' ');
  const hour = numberAt(words, 0);
  if (hour && hour[0] >= 1 && hour[0] <= 12) {
    const rest = words.slice(hour[1]);
    if (!rest.length) return { h: hour[0], m: 0, ampm: null, explicit: false };
    const mins = numberAt(rest, 0);
    if (mins && mins[0] <= 59 && rest.length === mins[1]) return { h: hour[0], m: mins[0], ampm: null, explicit: true };
    if (rest.length === 1 && (rest[0] === 'am' || rest[0] === 'pm')) return { h: hour[0], m: 0, ampm: rest[0], explicit: true };
  }
  return null;
}

// The Date a spoken time refers to, or null. The whole phrase must be understood: "at 5pm", "tomorrow at 9",
// "in 2 hours", "next monday at 10am", "tonight", "on october 25th at 2pm".
function parseWhen(text, now = new Date()) {
  let s = String(text).toLowerCase().replace(/[,.!?]/g, ' ').replace(/\ba\.?m\.?\b/g, 'am').replace(/\bp\.?m\.?\b/g, 'pm').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const rel = s.match(/^in (.+)$/);
  if (rel) {
    const secs = parseDuration(rel[1]);
    return secs ? new Date(now.getTime() + secs * 1000) : null;
  }

  let day = null; // a Date at midnight
  let part = null; // morning | afternoon | evening | night
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const plusDays = (n) => new Date(base.getTime() + n * 86400000);
  const eat = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    fn(m);
    return true;
  };

  eat(/\bday after tomorrow\b/, () => { day = plusDays(2); });
  eat(/\btomorrow\b/, () => { day = plusDays(1); });
  eat(/\btoday\b/, () => { day = plusDays(0); });
  eat(/\b(tonight|this evening)\b/, () => { day = day || plusDays(0); part = 'night'; });
  eat(/\b(?:(next|this|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, (m) => {
    const target = DAYS.indexOf(m[2]);
    let diff = (target - base.getDay() + 7) % 7;
    if (diff === 0 && m[1] === 'next') diff = 7;
    if (diff === 0 && !m[1]) diff = 7;
    day = plusDays(diff);
  });
  eat(/\b(?:on )?(?:the )?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) (\d{1,2})(?:st|nd|rd|th)?\b/, (m) => {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)));
    let d = new Date(base.getFullYear(), mi, +m[2]);
    if (d < base) d = new Date(base.getFullYear() + 1, mi, +m[2]);
    day = d;
  });
  eat(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/, (m) => {
    let d = new Date(base.getFullYear(), base.getMonth(), +m[1]);
    if (d < base) d = new Date(base.getFullYear(), base.getMonth() + 1, +m[1]);
    day = d;
  });
  eat(/\bnext week\b/, () => { day = plusDays(7); });
  eat(/\b(?:in the |this )?(morning|afternoon|evening|night)\b/, (m) => { part = part || m[1]; });

  // The clock time: what is left after the day words, minus filler.
  let clock = null;
  const words = s.split(' ').filter((w) => w && !FILLER.has(w));
  if (words.length) {
    clock = parseClock(words.join(' '));
    if (!clock) return null;
  }
  if (!day && !clock && !part) return null;

  let h;
  let m = 0;
  if (clock) {
    h = clock.h;
    m = clock.m;
    if (clock.ampm === 'pm' && h < 12) h += 12;
    else if (clock.ampm === 'am' && h === 12) h = 0;
    else if (!clock.ampm && h <= 12) {
      if (part === 'afternoon' || part === 'evening' || part === 'night') h = h === 12 ? 12 : h + 12;
      else if (part === 'morning') h = h === 12 ? 0 : h;
      else {
        // No am or pm: take the next time that clock face shows.
        const candidate = atTime(day || base, h % 12, m);
        const second = atTime(day || base, (h % 12) + 12, m);
        if (day) h = day.getTime() === base.getTime() && candidate <= now ? (h % 12) + 12 : h < 7 ? h + 12 : h;
        else h = candidate > now ? h % 12 : second > now ? (h % 12) + 12 : h % 12;
      }
    }
  } else if (part) {
    h = { morning: 9, afternoon: 14, evening: 18, night: 21 }[part];
  } else {
    h = 9; // a day on its own means that morning
  }

  let when = atTime(day || base, h, m);
  if (!day && when <= now) when = new Date(when.getTime() + 86400000); // a time that has passed today means tomorrow
  if (day && when <= now && day.getTime() === base.getTime() && !clock) return null;
  return when;
}

// "2026-10-17T17:00", the form the Reminders helper takes.
function localIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Splits "call mom at 5pm" or "at 5pm call mom" or "in 10 minutes to stretch" into { what, when }.
function splitReminder(text, now = new Date()) {
  const t = String(text).trim().replace(/[.!?]+$/, '');
  const words = t.split(/\s+/);
  const starters = new Set(['in', 'at', 'on', 'tomorrow', 'today', 'tonight', 'next', 'this', 'by', 'day']);
  // when-phrase at the end: find the earliest start word where the rest parses
  for (let i = 1; i < words.length; i++) {
    if (!starters.has(words[i].toLowerCase()) && !DAYS.includes(words[i].toLowerCase())) continue;
    const when = parseWhen(words.slice(i).join(' ').replace(/^by /i, 'at '), now);
    if (when) return { what: words.slice(0, i).join(' ').replace(/^to /i, ''), when };
  }
  // when-phrase at the start: "tomorrow at 9 to call mom", "in an hour to stretch"
  const lead = t.match(/^(.+?)\s+to\s+(.+)$/i);
  if (lead) {
    const when = parseWhen(lead[1], now);
    if (when) return { what: lead[2], when };
  }
  return { what: t.replace(/^to /i, ''), when: null };
}

module.exports = { parseDuration, parseWhen, parseClock, localIso, splitReminder };
