// The daily priority menu: turns the facts the morning briefing already gathers (calendar, reminders, school assignments, important email, what Relay
// could not finish, the weather) into one ranked list you can act on. Pure: no clock, no network. Only what the checked sources say goes in; a source
// that could not be read is listed as unavailable, never as empty, and a date that is not an exact calendar date is shown as written, not guessed.

const HOUR = 3600e3, DAY = 86400e3;
const GROUPS = ['now', 'today', 'soon', 'later'];
const GROUP_TITLE = { now: 'Needs attention now', today: 'Today', soon: 'Coming up', later: 'Later' };
const APPS = new Set(['Calendar', 'Reminders', 'Mail']);

const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const isoDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
};
const clean = (s, n = 120) => String(s || '').replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').replace(/"/g, '').trim().slice(0, n);

function buildPriorities(facts, { schoolUrl = '' } = {}) {
  const now = facts.now instanceof Date ? facts.now : new Date(), today = startOfDay(now);
  const items = [];
  let n = 0;
  const add = (it) => items.push({ id: `p${++n}`, detail: '', open: null, ...it });

  for (const d of facts.due || []) if (d.title) add({ title: clean(d.title), source: 'Reminders', group: d.overdue ? 'now' : 'today', when: d.overdue ? 'overdue' : 'due today', order: d.overdue ? 0 : 1, open: { app: 'Reminders' } });

  for (const e of facts.events || []) {
    if (!e || !e.title) continue;
    const title = clean(e.title), open = { app: 'Calendar' };
    if (!(e.start instanceof Date) || Number.isNaN(e.start.getTime()) || e.allDay) { add({ title, source: 'Calendar', group: 'today', when: 'all day', order: 5, open }); continue; }
    const ahead = e.start - now;
    if (ahead < 0) continue; // already started or over: not something to do next
    add({ title, source: 'Calendar', group: ahead <= HOUR ? 'now' : 'today', when: ahead <= HOUR ? `in ${Math.max(1, Math.round(ahead / 60000))} min, ${clock(e.start)}` : `at ${clock(e.start)}`, order: 2 + ahead / DAY, open });
  }

  const s = facts.school;
  if (s && !s.problem) for (const a of s.assignments || []) {
    if (!a || !a.title) continue;
    const title = clean(a.title), due = String(a.due || '').trim(), day = isoDay(due), open = /^https:\/\//i.test(schoolUrl) ? { url: schoolUrl } : null;
    if (!day) { add({ title, source: 'School', group: 'soon', when: due ? `due ${clean(due, 40)}` : 'due date not identified', order: 8, detail: 'The page gave no exact date, so it is not ranked by date.', open }); continue; }
    const days = Math.round((day - today) / DAY);
    if (days < 0) add({ title, source: 'School', group: 'now', when: `overdue, was due ${due}`, order: 0.5, open });
    else if (days === 0) add({ title, source: 'School', group: 'today', when: 'due today', order: 1.5, open });
    else if (days <= 7) add({ title, source: 'School', group: 'soon', when: days === 1 ? 'due tomorrow' : `due in ${days} days (${due})`, order: 6 + days / 10, open });
    else add({ title, source: 'School', group: 'later', when: `due ${due}`, order: 9 + days / 100, open });
  }

  for (const m of facts.mail || []) {
    if (!m || !m.subject) continue;
    const from = clean(String(m.from || '').replace(/<.*$/, ''), 60) || 'Unknown sender';
    add({ title: clean(m.subject), source: 'Email', group: 'soon', when: `from ${from}`, order: 7, detail: 'Important and unread, from the last two days.', open: m.id ? { url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(m.id))}` } : { app: 'Mail' } });
  }

  const ov = facts.overnight;
  if (ov && ov.summary && now.getTime() - ov.ts < 20 * HOUR && ov.ts <= now.getTime() + HOUR) add({ title: `Overnight: ${clean(ov.summary, 140)}`, source: 'Relay', group: ov.counts && ov.counts.problem ? 'now' : 'today', when: 'last night', order: ov.counts && ov.counts.problem ? 0.2 : 4.5, detail: 'Say "what happened overnight" for the full report.' });

  for (const h of facts.unfinished || []) if (h && h.text) add({ title: `Review: ${clean(h.text, 100)}`, source: 'Relay', group: 'soon', when: h.status === 'stopped' ? 'stopped before it finished' : 'did not work', order: 7.5 });

  items.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order);

  const missing = new Set(facts.missing || []);
  const sources = [
    ['Mac calendar', !missing.has('calendar')], ['Google calendar', !missing.has('google-calendar')], ['Reminders', !missing.has('reminders')], ['Email', !missing.has('mail')]
  ].map(([name, ok]) => ({ name, state: ok ? 'ok' : 'unavailable' }));
  sources.push(!facts.school ? { name: 'School assignments', state: 'unavailable', note: 'Could not be checked.' } : facts.school.problem ? { name: 'School assignments', state: 'unavailable', note: String(facts.school.problem).slice(0, 200) } : { name: 'School assignments', state: 'ok', note: facts.school.truncated ? 'The page was long; only the first part was read.' : '' });
  sources.push(missing.has('weather') ? { name: 'Weather', state: 'unavailable', note: 'Set your city in Settings.' } : missing.has('weather-unavailable') ? { name: 'Weather', state: 'unavailable', note: 'The weather service did not answer.' } : { name: 'Weather', state: 'ok' });

  const w = facts.weather;
  const weather = w && Number.isFinite(w.tempNow) ? `${w.city || 'Here'}: ${w.tempNow}° now, high ${w.high}°, low ${w.low}°${Number.isFinite(w.rain) && w.rain >= 30 ? `, ${w.rain}% chance of rain` : ''}` : null;

  const counts = Object.fromEntries(GROUPS.map((g) => [g, items.filter((i) => i.group === g).length]));
  const down = sources.filter((x) => x.state !== 'ok').length;
  const headline = counts.now ? `${counts.now} thing${counts.now === 1 ? ' needs' : 's need'} attention now.` : counts.today ? `Nothing urgent. ${counts.today} thing${counts.today === 1 ? '' : 's'} today.` : items.length ? 'Nothing for today. Things are coming up.' : 'Nothing is pressing in the sources I could check.';
  return { at: now.getTime(), headline: down ? `${headline} ${down} source${down === 1 ? '' : 's'} could not be checked.` : headline, weather, items, counts, sources, groups: GROUP_TITLE };
}

// What an item's button may do, from the item alone (the screen never supplies an address): open Calendar, Reminders or Mail, or an https page.
function resolveOpen(item) {
  const o = item && item.open;
  if (!o) return null;
  if (o.app && APPS.has(o.app)) return { app: o.app };
  if (o.url && /^https:\/\/[^\s]+$/i.test(o.url)) return { url: o.url };
  return null;
}

// "show my priorities", "what should I do today", "what needs my attention", "priority menu".
function parsePrioritiesCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  if (!n || n.split(' ').length > 12) return false;
  return /^(?:show|open|give|pull up|bring up|display)(?: me)?(?: my| the| today's| todays)? ?(?:daily |today's |todays )?(?:priorities|priority list|priority menu|priority|to ?do list|todo list)(?: for today| today)?$/.test(n)
    || /^(?:daily |today's |todays )?(?:priorities|priority menu|priority list)(?: today)?$/.test(n)
    || /^what(?:'s| is| are) my (?:top |main |biggest )?(?:priority|priorities)(?: today| for today| right now)?$/.test(n)
    || /^what(?:'s| is) (?:most |the most )?(?:important|urgent|pressing)(?: for me)?(?: today| right now| now)?$/.test(n)
    || /^what (?:should|do) i (?:do|need to do|work on|focus on|tackle)(?: first| next| today| now| right now)?$/.test(n)
    || /^what needs (?:my )?attention(?: today| now| right now)?$/.test(n)
    || /^what(?:'s| is) (?:due|overdue|coming up)(?: soon| today)?$/.test(n);
}

module.exports = { buildPriorities, resolveOpen, parsePrioritiesCommand, GROUPS, GROUP_TITLE };
