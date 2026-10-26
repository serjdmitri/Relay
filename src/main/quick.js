// Instant handling of simple spoken commands, with no model call: "open Notes", "pause", "set a timer for 5
// minutes", "remind me to call mom at 5", "new note buy milk", "open github.com", "brightness down", "what time
// is it". Anything that is not exactly one of these goes to the model.
// parseQuick is pure; runQuick does the work through the same mac helpers the tools use, and returns an undo
// for what it did when that is possible.

const { normalize } = require('./commands');
const { parseDuration, parseWhen, splitReminder, localIso } = require('./when');
const { humanDuration } = require('./timers');
const { parseWindowCommand, layoutRect, pickArea, NAMES: WINDOW_NAMES } = require('./windows');

const ALIASES = {
  chrome: 'Google Chrome', 'google chrome': 'Google Chrome', code: 'Visual Studio Code', vscode: 'Visual Studio Code', 'vs code': 'Visual Studio Code',
  'visual studio code': 'Visual Studio Code', settings: 'System Settings', 'system settings': 'System Settings', 'system preferences': 'System Settings',
  preferences: 'System Settings', word: 'Microsoft Word', excel: 'Microsoft Excel', powerpoint: 'Microsoft PowerPoint', outlook: 'Microsoft Outlook',
  teams: 'Microsoft Teams', imessage: 'Messages', messages: 'Messages', 'text messages': 'Messages', terminal: 'Terminal', finder: 'Finder',
  'activity monitor': 'Activity Monitor', 'app store': 'App Store', quicktime: 'QuickTime Player', 'quicktime player': 'QuickTime Player'
};

const FOLDERS = {
  downloads: '~/Downloads', desktop: '~/Desktop', documents: '~/Documents', pictures: '~/Pictures', movies: '~/Movies',
  music: '~/Music', applications: '/Applications', home: '~'
};

// Well-known sites. If an app of the same name is installed (Spotify, Slack…) the app is opened instead.
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com', github: 'https://github.com',
  reddit: 'https://www.reddit.com', twitter: 'https://x.com', facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com', netflix: 'https://www.netflix.com', amazon: 'https://www.amazon.com', wikipedia: 'https://www.wikipedia.org',
  'google maps': 'https://maps.google.com', chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', 'hacker news': 'https://news.ycombinator.com',
  'google drive': 'https://drive.google.com', 'google docs': 'https://docs.google.com', 'google calendar': 'https://calendar.google.com',
  twitch: 'https://www.twitch.tv', spotify: 'https://open.spotify.com', notion: 'https://www.notion.so', slack: 'https://app.slack.com', figma: 'https://www.figma.com'
};

const SEARCH = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  wikipedia: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  maps: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`
};

// Words that mean the request is bigger than "open an app".
const COMPOUND = /\b(and|then|to|for|with|in|on|at|about|that|which|where|when|new|a|an|my last|some|from|into|called|named|first|second|third|fourth|fifth|next|previous|last|this|it|them|those|these|result|link|tab|window|file|page)\b/;

const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const clean = (s) => s.replace(/^(the|my) /, '').replace(/ (app|application)$/, '').trim();
const canonical = (n) => ALIASES[n] || titleCase(n);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Casing and times kept (normalize() strips ":" and "."); only the polite words and the final punctuation go.
function lite(text) {
  return String(text).trim().replace(/[“”"]/g, '').replace(/\s+/g, ' ').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?relay[, ]*/i, '').replace(/^please /i, '').replace(/ please$/i, '').trim();
}

const DOMAIN = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i;

function toUrl(raw) {
  const t = raw.trim().replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
  if (!DOMAIN.test(t)) return null;
  return /^https?:/i.test(t) ? t : `https://${t}`;
}

function parseQuick(text, now = new Date()) {
  const L = lite(text);
  const n = normalize(text);
  if (!n || n.split(' ').length > 40) return null;
  let m;

  // ----- reminders and notes: the user's own words and casing are kept -----
  if ((m = L.match(/^remind me (.+)$/i)) || (m = L.match(/^(?:add |create |make |set )(?:a |me a )?reminder (?:to |for |that )?(.+)$/i))) {
    const { what, when } = splitReminder(m[1], now);
    if (!what) return null;
    return { type: 'reminder', what: cap(what), when };
  }
  if ((m = L.match(/^(?:make|create|start|take|write|add|jot down) (?:me )?(?:a |another )?(?:quick )?(?:new )?note (?:called|named|titled) (.+?)(?: (?:saying|that says|with|that reads|and say|and write|reading) (.+))?$/i))) {
    return { type: 'note', title: cap(m[1].trim()), body: m[2] ? cap(m[2].trim()) : '' };
  }
  if (/^(?:make|create|start|take|write|add|jot down) (?:me )?(?:a |another )?(?:quick )?(?:new )?note$/i.test(L)) {
    return { type: 'note', title: 'New note', body: '' };
  }
  if ((m = L.match(/^(?:new note|note to self|take a note|make a note|add a note|note that|note)(?:[:,]| that| to self| saying| says)? (.+)$/i)) && !/^(?:book|pad|taking|card)\b/i.test(m[1])) {
    const body = cap(m[1].trim());
    return { type: 'note', title: body.length > 60 ? body.slice(0, 57).trimEnd() + '…' : body, body: body.length > 60 ? body : '' };
  }

  // ----- timers and alarms -----
  if (/^(?:cancel|stop|clear|delete|remove|turn off|dismiss) (?:the |my |all |every )?(?:timers?|alarms?)$/.test(n)) return { type: 'timer-cancel' };
  if (/^(?:how (?:much )?(?:time|long)(?: is)? (?:left|remaining)(?: on (?:the |my )?(?:timer|alarm))?|how long is (?:the |my )?timer|what is left on (?:the |my )?timer|whats left on (?:the |my )?timer|timer status|check (?:the |my )?timer|how much time is left)$/.test(n)) return { type: 'timer-status' };
  if ((m = n.match(/^(?:set |start |create |begin )?(?:a |an )?(?:timer|countdown)(?: for| of)? (.+)$/)) || (m = n.match(/^(?:set |start |create |begin )(?:a |an )?(.+?) (?:timer|countdown)$/)) || (m = n.match(/^(.+?) (?:timer|countdown)$/))) {
    const seconds = parseDuration(m[1]);
    if (seconds && seconds <= 86400) return { type: 'timer', seconds, label: '' };
  }
  if ((m = L.match(/^(?:set |create )(?:an? )?alarm(?: for| at)? (.+)$/i)) || (m = L.match(/^wake me(?: up)? (?:at |in )(.+)$/i))) {
    const when = parseWhen(/^wake me(?: up)? in /i.test(L) ? 'in ' + m[1] : m[1], now);
    if (when) return { type: 'alarm', when };
  }

  // ----- the web -----
  let engine = null;
  let query = null;
  if ((m = L.match(/^(?:search|look)(?: up)? (youtube|amazon|wikipedia|google|maps)(?: for)? (.+)$/i))) [engine, query] = [m[1].toLowerCase(), m[2]];
  else if ((m = L.match(/^(?:google|search google for|google search for|search the (?:web|internet) for) (.+)$/i))) [engine, query] = ['google', m[1]];
  if (engine && query) return { type: 'search', engine, query: query.trim(), url: SEARCH[engine](query.trim()) };

  if ((m = L.match(/^(?:open|go to|goto|visit|pull up|load|browse to|take me to|navigate to)(?: the)?(?: website| site| page| url| link)? (.+)$/i))) {
    const url = toUrl(m[1]);
    if (url) return { type: 'open-url', url };
    const site = m[1].toLowerCase().replace(/^the /, '').replace(/ (?:website|site|page)$/, '').trim();
    if (SITES[site]) return { type: 'open-site', name: titleCase(site), url: SITES[site] };
  }

  // Everything below is about apps and the system; web addresses and paths are never app names.
  if (/[a-z0-9-]\.[a-z]{2,}\b|https?:|\//i.test(String(text))) return null;

  // ----- windows: halves, corners, thirds, centre, full -----
  const win = parseWindowCommand(n);
  if (win) return { type: 'window', position: win.position, app: win.app ? (ALIASES[win.app] || titleCase(win.app)) : null };

  if ((m = n.match(/^(?:set |turn )?(?:the )?(?:volume|sound)(?: to)? (\d{1,3})(?: percent)?$/))) return { type: 'volume', op: 'set', value: Math.min(100, +m[1]) };
  if ((m = n.match(/^(?:turn )?(?:the )?(?:volume|sound) (up|down)$/)) || (m = n.match(/^turn (up|down) the (?:volume|sound)$/))) return { type: 'volume', op: m[1] };
  if ((m = n.match(/^(mute|unmute)(?: the)?(?: volume| sound| audio)?$/))) return { type: 'volume', op: m[1] };

  if ((m = n.match(/^(?:set |turn )?(?:the )?(?:screen |display )?brightness (?:to |at )?(\d{1,3})(?: percent)?$/))) return { type: 'brightness', op: 'set', value: Math.min(100, +m[1]) / 100 };
  if ((m = n.match(/^(?:turn )?(?:the )?(?:screen |display )?brightness (up|down)$/)) || (m = n.match(/^(?:make )?(?:the )?(?:screen |display )?(brighter|dimmer|darker)$/))) {
    return { type: 'brightness', op: m[1] === 'up' || m[1] === 'brighter' ? 'up' : 'down' };
  }
  if (/^(?:max|maximum|full) (?:screen |display )?brightness$/.test(n)) return { type: 'brightness', op: 'set', value: 1 };
  if (/^(?:min|minimum|lowest) (?:screen |display )?brightness$/.test(n)) return { type: 'brightness', op: 'set', value: 0.05 };

  if (/^(?:turn on|enable|switch to|go to|use|set) dark(?: mode)?$/.test(n) || n === 'dark mode') return { type: 'dark', on: true };
  if (/^(?:turn off|disable) dark(?: mode)?$/.test(n) || /^(?:switch to|go to|use|set|turn on|enable) light(?: mode)?$/.test(n) || n === 'light mode') return { type: 'dark', on: false };

  // ----- music and video -----
  if ((m = n.match(/^(?:play|resume|continue|unpause)(?: the)?(?: music| song| track| playback| audio| video)?(?: on)?(?: (spotify|apple music))?$/))) return { type: 'media', op: 'play', app: m[1] };
  if (/^(?:pause|stop)(?: the)?(?: music| song| track| playback| audio| video| spotify| apple music)?$/.test(n)) return { type: 'media', op: 'pause' };
  if (/^(?:next|skip|next song|next track|skip song|skip track|skip this song|skip this track|skip it|play the next song|play the next track|go to the next song|go to the next track)$/.test(n)) return { type: 'media', op: 'next' };
  if (/^(?:previous|previous song|previous track|last song|last track|play the previous song|play the previous track|play the last song|go back a song|go back a track|go back one song)$/.test(n)) return { type: 'media', op: 'previous' };

  // ----- facts and small system things -----
  if (/^(?:whats|what is) the time(?: right now| now)?$|^what time is it(?: right now| now)?$|^tell me the time$|^the time$/.test(n)) return { type: 'info', what: 'time' };
  if (/^(?:whats|what is) (?:todays |the )?date(?: today)?$|^what day is it(?: today)?$|^(?:whats|what is) today$|^todays date$/.test(n)) return { type: 'info', what: 'date' };
  if (/^(?:whats |what is |how is )?(?:my |the )?battery(?: level| percentage| percent| status| life)?$|^how much battery(?: do i have| is left| life is left| is left on my mac| is left on my laptop)?$/.test(n)) return { type: 'info', what: 'battery' };
  if (/^lock(?: my| the)?(?: screen| mac| computer| laptop)?$/.test(n)) return { type: 'lock' };
  if (/^(?:turn off|sleep|put to sleep) (?:the |my )?(?:screen|display)$|^(?:the |my )?(?:screen|display) (?:off|to sleep)$/.test(n)) return { type: 'display-sleep' };

  // ----- apps and folders -----
  if ((m = n.match(/^(?:open|launch|start|run|open up) (.+)$/))) {
    const raw = m[1];
    const folder = raw.match(/^(?:the |my )?(downloads|desktop|documents|pictures|movies|music|applications|home) (?:folder|directory)$/) || (raw.match(/^(?:the |my )?(downloads|desktop|documents|pictures|movies|applications|home)$/));
    if (folder) return { type: 'folder', key: folder[1] };
    const target = clean(raw);
    if (SITES[target]) return { type: 'open-site', name: titleCase(target), url: SITES[target] };
    if (!target || COMPOUND.test(target) || target.split(' ').length > 3 || /[./:]/.test(target)) return null;
    return { type: 'open-app', name: canonical(target) };
  }

  if ((m = n.match(/^(?:switch|go|jump|get|bring up) (?:back )?(?:to )?(.+)$/)) || (m = n.match(/^focus (?:on )?(.+)$/)) || (m = n.match(/^show (?:me )?(?:the )?(.+?) (?:app|window)$/))) {
    const target = clean(m[1]);
    if (!target || COMPOUND.test(target) || target.split(' ').length > 3) return null;
    return { type: 'focus-app', name: canonical(target) };
  }

  if ((m = n.match(/^(?:quit|exit|force quit) (.+)$/))) {
    const target = clean(m[1]);
    if (!target || COMPOUND.test(target) || target.split(' ').length > 3 || /^(all|everything)\b/.test(target)) return null;
    return { type: 'quit-app', name: canonical(target) };
  }
  return null;
}

// Finds the running app that matches what was said, ignoring case.
function matchRunning(name, running) {
  const lc = name.toLowerCase();
  return running.find((a) => a.toLowerCase() === lc) || running.find((a) => a.toLowerCase().startsWith(lc)) || null;
}

const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function whenText(d, now) {
  if (sameDay(d, now)) return `at ${clock(d)}`;
  if (sameDay(d, new Date(now.getTime() + 86400000))) return `tomorrow at ${clock(d)}`;
  return `on ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${clock(d)}`;
}

// Which music app to control, and what it is doing. Reads state only from apps that are already running.
async function players(mac, want) {
  const running = await mac.listApps();
  const states = [];
  for (const app of running.filter((a) => a === 'Spotify' || a === 'Music')) {
    let state = 'stopped';
    try {
      state = String(await mac.osa(`tell application "${app}" to return (player state as text)`)).trim().toLowerCase();
    } catch {}
    states.push({ app, state });
  }
  if (want) {
    const name = /spotify/i.test(want) ? 'Spotify' : 'Music';
    return { states, pick: states.find((s) => s.app === name) || { app: name, state: 'stopped', notRunning: true } };
  }
  return { states, playing: states.find((s) => s.state.includes('playing')), any: states[0] };
}

async function nowPlaying(mac, app) {
  try {
    return String(await mac.osa(`tell application "${app}" to return (name of current track) & " by " & (artist of current track)`)).trim();
  } catch {
    return '';
  }
}

const pct = (v) => Math.round(v * 100);

// Returns { tool, input, reply, undo? } when it handled the command, or null to let the model take it.
// ctx: { timers, brightness: { get(), set(v) }, now(), prevApp, runningApps }
async function runQuick(cmd, mac, ctx = {}) {
  const now = ctx.now ? ctx.now() : new Date();
  switch (cmd.type) {
    case 'open-app': {
      const wasRunning = (ctx.runningApps || []).some((a) => a.toLowerCase() === cmd.name.toLowerCase());
      try {
        await mac.openApp(cmd.name);
      } catch {
        return null; // not an installed app: the model may know what was meant
      }
      return {
        tool: 'open_app', input: { name: cmd.name }, reply: `Opened ${cmd.name}.`,
        undo: wasRunning ? undefined : async () => { await mac.quitApp(cmd.name); return `Closed ${cmd.name}.`; }
      };
    }
    case 'window': {
      const app = cmd.app || ctx.prevApp;
      if (!app) return null; // no idea which window: the model can ask or look
      let before;
      try {
        before = await mac.windowFrame(app);
      } catch (e) {
        return { tool: 'arrange_window', input: { app, position: cmd.position }, reply: e.message, readonly: true };
      }
      const area = pickArea(ctx.displays ? ctx.displays() : [], before, 'this');
      const after = await mac.setWindowFrame(app, layoutRect(cmd.position, area));
      return {
        tool: 'arrange_window', input: { app, position: cmd.position }, reply: `Moved ${app} to ${WINDOW_NAMES[cmd.position]}.`,
        undo: async () => { await mac.setWindowFrame(app, before); return `Put ${app} back where it was.`; }
      };
    }
    case 'open-site': {
      try {
        await mac.openApp(cmd.name);
        return { tool: 'open_app', input: { name: cmd.name }, reply: `Opened ${cmd.name}.` };
      } catch {
        await mac.openUrl(cmd.url, null);
        return { tool: 'open_url', input: { url: cmd.url }, reply: `Opened ${cmd.name}.` };
      }
    }
    case 'open-url':
      await mac.openUrl(cmd.url, null);
      return { tool: 'open_url', input: { url: cmd.url }, reply: `Opened ${new URL(cmd.url).hostname.replace(/^www\./, '')}.` };
    case 'search':
      await mac.openUrl(cmd.url, null);
      return { tool: 'open_url', input: { url: cmd.url }, reply: `Searching ${cmd.engine === 'maps' ? 'Maps' : cap(cmd.engine)} for ${cmd.query}.` };
    case 'folder': {
      const p = FOLDERS[cmd.key];
      await mac.openPath(p);
      return { tool: 'open_path', input: { path: p }, reply: `Opened your ${cmd.key === 'home' ? 'home' : cap(cmd.key)} folder.` };
    }
    case 'focus-app': {
      const app = matchRunning(cmd.name, await mac.listApps());
      if (!app) return null;
      await mac.focusApp(app);
      const back = ctx.prevApp;
      return { tool: 'focus_app', input: { name: app }, reply: `Switched to ${app}.`, undo: back && back !== app ? async () => { await mac.focusApp(back); return `Went back to ${back}.`; } : undefined };
    }
    case 'quit-app': {
      const app = matchRunning(cmd.name, await mac.listApps());
      if (!app) return null;
      await mac.quitApp(app);
      return { tool: 'quit_app', input: { name: app }, reply: `Quit ${app}.`, undo: async () => { await mac.openApp(app); return `Reopened ${app}.`; } };
    }
    case 'volume': {
      const prev = Number(await mac.osa('output volume of (get volume settings)').catch(() => NaN));
      const restore = Number.isFinite(prev) ? async () => { await mac.osa(`set volume output volume ${Math.round(prev)}`); await mac.osa('set volume without output muted'); return `Volume back to ${Math.round(prev)}.`; } : undefined;
      if (cmd.op === 'mute') {
        await mac.osa('set volume with output muted');
        return { tool: 'set_volume', input: { muted: true }, reply: 'Muted.', undo: async () => { await mac.osa('set volume without output muted'); return 'Unmuted.'; } };
      }
      if (cmd.op === 'unmute') {
        await mac.osa('set volume without output muted');
        return { tool: 'set_volume', input: { muted: false }, reply: 'Unmuted.' };
      }
      let v = cmd.value;
      if (cmd.op !== 'set') v = Math.max(0, Math.min(100, (Number.isFinite(prev) ? prev : 50) + (cmd.op === 'up' ? 12 : -12)));
      await mac.osa(`set volume output volume ${Math.round(v)}`);
      return { tool: 'set_volume', input: { level: Math.round(v) }, reply: `Volume ${cmd.op === 'set' ? 'set to' : cmd.op === 'up' ? 'up to' : 'down to'} ${Math.round(v)}.`, undo: restore };
    }
    case 'brightness': {
      if (!ctx.brightness) return null;
      let cur;
      try {
        cur = await ctx.brightness.get();
      } catch {
        return null; // no built-in display, or no helper: let the model say so
      }
      let v = cmd.value;
      if (cmd.op === 'up') v = Math.min(1, cur + 0.15);
      if (cmd.op === 'down') v = Math.max(0.03, cur - 0.15);
      const set = await ctx.brightness.set(v);
      return { tool: 'set_brightness', input: { level: pct(set) }, reply: `Brightness ${cmd.op === 'set' ? 'set to' : cmd.op === 'up' ? 'up to' : 'down to'} ${pct(set)}%.`, undo: async () => { await ctx.brightness.set(cur); return `Brightness back to ${pct(cur)}%.`; } };
    }
    case 'dark': {
      const prev = String(await mac.osa('tell application "System Events" to tell appearance preferences to get dark mode').catch(() => '')).trim() === 'true';
      await mac.osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${cmd.on}`);
      return { tool: 'dark_mode', input: { on: cmd.on }, reply: cmd.on ? 'Dark mode is on.' : 'Light mode is on.', undo: async () => { await mac.osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${prev}`); return prev ? 'Dark mode is back on.' : 'Light mode is back on.'; } };
    }
    case 'media': {
      const { states, playing, any, pick } = await players(mac, cmd.app);
      const target = pick || (cmd.op === 'play' ? states.find((s) => s.state.includes('paused')) || any : playing || any);
      const flip = { play: 'pause', pause: 'play', next: 'previous', previous: 'next' };
      if (!target || target.notRunning) {
        if (cmd.op === 'play') {
          await mac.mediaKey('play');
          return { tool: 'media', input: { op: 'play' }, reply: 'Playing.', undo: async () => { await mac.mediaKey('play'); return 'Paused.'; } };
        }
        return { tool: 'media', input: { op: cmd.op }, reply: 'Nothing is playing.', readonly: true };
      }
      if (cmd.op === 'play' && target.state.includes('playing')) return { tool: 'media', input: { op: 'play' }, reply: `${target.app} is already playing.`, readonly: true };
      if (cmd.op === 'pause' && !target.state.includes('playing')) return { tool: 'media', input: { op: 'pause' }, reply: 'Nothing is playing.', readonly: true };
      await mac.mediaControl(target.app, cmd.op);
      let reply = cmd.op === 'pause' ? 'Paused.' : 'Playing.';
      if (cmd.op !== 'pause') {
        await new Promise((r) => setTimeout(r, 350));
        const track = await nowPlaying(mac, target.app);
        reply = cmd.op === 'play' ? (track ? `Playing ${track}.` : 'Playing.') : track ? `${cmd.op === 'next' ? 'Skipped to' : 'Back to'} ${track}.` : cmd.op === 'next' ? 'Skipped.' : 'Went back.';
      }
      return { tool: 'media', input: { op: cmd.op, app: target.app }, reply, undo: async () => { await mac.mediaControl(target.app, flip[cmd.op]); return cmd.op === 'play' ? 'Paused.' : cmd.op === 'pause' ? 'Playing again.' : 'Went back.'; } };
    }
    case 'timer': {
      if (!ctx.timers) return null;
      const t = ctx.timers.add(cmd.seconds, cmd.label);
      return { tool: 'timer', input: { seconds: cmd.seconds }, reply: `Timer set for ${humanDuration(cmd.seconds)}.`, undo: async () => { ctx.timers.cancel(t.id); return 'Cancelled the timer.'; } };
    }
    case 'alarm': {
      if (!ctx.timers) return null;
      const seconds = Math.max(1, Math.round((cmd.when.getTime() - now.getTime()) / 1000));
      const t = ctx.timers.add(seconds, 'Alarm');
      return { tool: 'timer', input: { seconds, alarm: true }, reply: `Alarm set ${whenText(cmd.when, now)}. Relay has to be running for it to ring.`, undo: async () => { ctx.timers.cancel(t.id); return 'Cancelled the alarm.'; } };
    }
    case 'timer-cancel': {
      if (!ctx.timers) return null;
      const n = ctx.timers.cancelAll();
      return { tool: 'timer', input: { cancel: true }, reply: n ? `Cancelled ${n === 1 ? 'your timer' : n + ' timers'}.` : 'You have no timers running.' };
    }
    case 'timer-status': {
      if (!ctx.timers) return null;
      const list = ctx.timers.list();
      if (!list.length) return { tool: 'timer', input: { status: true }, reply: 'You have no timers running.', readonly: true };
      const parts = list.map((t) => `${humanDuration(ctx.timers.remainingSeconds(t))}${t.label ? ' on the ' + t.label.toLowerCase() : ''}`);
      return { tool: 'timer', input: { status: true }, reply: list.length === 1 ? `${parts[0]} left.` : `${parts.join(', and ')} left.`, readonly: true };
    }
    case 'reminder': {
      const id = await mac.remindersAddId(cmd.what, cmd.when ? localIso(cmd.when) : null);
      const what = lower1(cmd.what);
      return {
        tool: 'reminders_add', input: { title: cmd.what, due: cmd.when ? localIso(cmd.when) : undefined },
        reply: cmd.when ? `I'll remind you to ${what} ${whenText(cmd.when, now)}.` : `Added a reminder to ${what}.`,
        undo: id ? async () => { await mac.remindersDeleteById(id); return 'Deleted that reminder.'; } : undefined
      };
    }
    case 'note': {
      const id = await mac.notesCreateId(cmd.title, cmd.body);
      return { tool: 'notes_create', input: { title: cmd.title, body: cmd.body }, reply: `Made a note called "${cmd.title}".`, undo: id ? async () => { await mac.notesDeleteById(id); return 'Deleted that note.'; } : undefined };
    }
    case 'info': {
      if (cmd.what === 'time') return { tool: 'clock', input: {}, reply: `It's ${clock(now)}.`, readonly: true };
      if (cmd.what === 'date') return { tool: 'clock', input: {}, reply: `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`, readonly: true };
      const b = await mac.batteryStatus();
      if (!b) return { tool: 'battery', input: {}, reply: 'This Mac has no battery.', readonly: true };
      return { tool: 'battery', input: {}, reply: `Battery is at ${b.percent}%${b.state ? ', ' + b.state : ''}${b.remaining ? ', about ' + b.remaining + ' left' : ''}.`, readonly: true };
    }
    case 'lock':
      await mac.lockScreen();
      return { tool: 'lock_screen', input: {}, reply: 'Locked.' };
    case 'display-sleep':
      await mac.sleepDisplay();
      return { tool: 'display_sleep', input: {}, reply: 'Display off.' };
    default:
      return null;
  }
}

module.exports = { parseQuick, runQuick, matchRunning, ALIASES, FOLDERS, SITES, lite };
