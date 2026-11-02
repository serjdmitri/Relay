// One vocabulary for built-in read-only menus. Words can appear anywhere in a request.
const normalize = text => String(text || '').replace(/[’‘]/g, "'").replace(/wi[ -]fi/gi, 'wifi').replace(/\s+/g, ' ').trim();
const ACTION = /\b(?:delete|erase|wipe|move|organize|rename|email|send|text|message|save|remember|forget|schedule|connect|disconnect|install|uninstall|update|write|edit|download|upload|restart|shutdown|shut down|cancel|close|hide|dismiss|remove|stop|disable|enable|turn (?:on|off)|set (?:a |the |my )?(?:timer|reminder|alarm|password))\b/i;
const DISCUSSION = /\b(?:explain|teach|learn|define|definition|article|essay|tutorial|source code|implement|programming|translate|compare)\b|\b(?:what is|what's|whats) (?:a|an)\b/i;
function eligible(text) {
  return !/\bopen (?:notes|safari|chrome|firefox|mail|terminal|finder|messages|calendar)\b|\b(?:google drive|onedrive|icloud|dropbox)\b/i.test(text) && !ACTION.test(text) && !DISCUSSION.test(text) && !/\b(?:don't|do not|never|without|not now|no need)\b/i.test(text);
}
const WORDS = {
  storage: /\b(?:storage|disk(?: space| usage)?|hard drive|ssd|computer(?:'s|s)? space|space (?:on|in) (?:my |the )?(?:mac|computer|laptop)|(?:free|available|remaining|out of|low on) space|space (?:left|used|full|is full)|(?:filling|taking|using)(?: up)? (?:all )?(?:my |the )?space)\b/i,
  weather: /\b(?:weather|forecast|raining|rain|sunny)\b|\b(?:outside temperature|how (?:hot|cold))\b/i,
  calculator: /\b(?:calculator|calculater|calc)\b/i,
  cpu: /\b(?:cpu|processor|processing load)\b/i,
  memory: /\b(?:ram|memory (?:usage|use|pressure|load|stats|panel|monitor))\b/i,
  battery: /\b(?:battery|batteries|charge level)\b/i,
  network: /\b(?:network|wifi|internet|bandwidth|connection speed)\b/i,
  system: /\b(?:system (?:status|stats|health|diagnostics|monitor|panel|performance)|computer (?:status|stats|health|diagnostics|performance)|mac (?:status|stats|health|diagnostics|performance))\b/i,
  dashboard: /\b(?:activity (?:center|centre)|dashboard|task (?:progress|status)|what (?:are you|is jarvis) working on)\b/i
};
function menuTopics(text) {
  const t = normalize(text);
  if (!eligible(t)) return [];
  // Device inventories retain their own existing commands rather than losing the requested drive identity.
  if (/\b(?:drives|volumes|usb|sd card)\b.*\b(?:connected|plugged|mounted)|\b(?:connected|plugged|mounted)\b.*\b(?:drives|volumes|usb|sd card)\b/i.test(t)) return [];
  return Object.keys(WORDS).filter(key => WORDS[key].test(t));
}
function weatherQuery(text) {
  const t = normalize(text);
  if (!eligible(t) || !WORDS.weather.test(t)) return null;
  const unit = /\b(celsius|centigrade|fahrenheit)\b/i.exec(t);
  const clean = t.replace(/\s+(?:in )?(?:celsius|centigrade|fahrenheit)\b/gi, '').replace(/[?.!]+$/, '');
  const after = /\b(?:weather|forecast|temperature|be|rain|raining|sunny)\b.*?\b(?:in|for|at|around)\s+(.+)/i.exec(clean);
  let place = after?.[1] || '';
  // End a location at another known menu clause; leave city names intact.
  const next = /\s+(?:and|plus|also|along with)\s+(?:(?:show|open|bring up|give)(?: me)?\s+)?(?:(?:a|the|my)\s+)?(?:calculator|calc|storage|disk|cpu|ram|battery|network|wifi|system|activity)\b/i.exec(place);
  if (next) place = place.slice(0, next.index);
  place = place.replace(/(?:,?\s+)(?:please|thanks|right now|today|tomorrow|this week|this weekend|for today|for tomorrow)(?:\s+please)?$/i, '').trim();
  if (/^(?:me|my|the)\b/i.test(place)) place = ''; // "weather for me" uses the configured city
  return { place, ...(unit ? { units: /^f/i.test(unit[1]) ? 'f' : 'c' } : {}) };
}
const TITLES = { cpu: 'CPU use', memory: 'Memory use', battery: 'Battery', network: 'Network speed', dashboard: 'Activity center', system: 'System' };
function menuRequests(text) {
  return menuTopics(text).map(kind => kind === 'weather' ? { kind, query: weatherQuery(text) } : { kind, title: TITLES[kind] });
}
module.exports = { normalize, eligible, menuTopics, menuRequests, weatherQuery };
