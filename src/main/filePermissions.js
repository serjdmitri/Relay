// File permission levels: every tool call that reads, creates, moves, changes or deletes files is rated low, medium, high or critical, and each
// level has an approval rule you choose: allow (no question), ask (the Mac or your phone may answer), ask on this Mac only (a phone or text can
// not approve it), or never. The rules can only add a question or a refusal: a tool that already asks still asks, so nothing here lowers the
// bar. Critical can never be allowed outright. Pure and Electron-free, so the whole rating can be tested.

const path = require('path');
const { pathsIn } = require('./homeGuard');

const LEVELS = ['low', 'medium', 'high', 'critical'];
const RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const ALLOWED = { low: ['allow', 'ask'], medium: ['allow', 'ask', 'ask-mac', 'deny'], high: ['ask', 'ask-mac', 'deny'], critical: ['ask-mac', 'deny'] };
const DEFAULTS = { low: 'allow', medium: 'allow', high: 'ask', critical: 'ask-mac' };
const TITLE = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

// The rules from settings, with anything missing or not permitted for that level replaced by its default (critical can never become "allow").
function rulesFrom(setting) {
  const l = (setting && setting.levels) || {};
  return Object.fromEntries(LEVELS.map((k) => [k, ALLOWED[k].includes(l[k]) ? l[k] : DEFAULTS[k]]));
}

const SECRET = [/\/\.(?:ssh|gnupg|aws|kube|docker)(?:\/|$)/, /\/\.netrc$/, /\/\.config\/(?:gcloud|gh|op)(?:\/|$)/, /\/Library\/(?:Keychains|Cookies|Messages|Mail|Safari)(?:\/|$)/,
  /\/Library\/Application Support\/(?:Google\/Chrome|Firefox|BraveSoftware|Microsoft Edge|Relay|com\.apple\.TCC)(?:\/|$)/, /\/Library\/(?:LaunchAgents|LaunchDaemons)(?:\/|$)/,
  /\/\.(?:zshrc|zprofile|zshenv|bashrc|bash_profile|profile)$/, /\/id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/, /\.(?:pem|p12|keychain|keychain-db)$/];
const SYSTEM = /^\/(?:System|Library|usr|bin|sbin|etc|private\/etc|var|private\/var|opt|Applications|cores|dev)(?:\/|$)/;
const TEMP = /^\/(?:private\/)?(?:tmp|var\/folders)(?:\/|$)/;

function categorize(p, home) {
  const s = String(p || '').trim().replace(/^(?:\$HOME|\$\{HOME\})(?=\/|$)/, home).replace(/^~(?=\/|$)/, home);
  if (!s.startsWith('/')) return 'inside'; // a relative path starts where Relay runs, in the home folder
  const full = path.resolve(s);
  if (TEMP.test(full)) return 'temp';
  if (full === '/' || full === home || full === path.dirname(home)) return 'broad';
  if (SECRET.some((re) => re.test(full))) return 'secret';
  if (SYSTEM.test(full)) return 'system';
  if (/^\/Volumes(?:\/|$)/.test(full)) return 'volume';
  return full.startsWith(home + path.sep) ? 'inside' : 'outside';
}
const CAT_WORDS = { secret: 'credentials or private data', system: 'a system location', volume: 'another drive', outside: 'outside your home folder', broad: 'a whole top-level folder' };

// kind x place -> level
const TABLE = {
  read:   { temp: 'low', inside: 'low', secret: 'high', system: 'high', volume: 'high', outside: 'high', broad: 'medium' },
  create: { temp: 'low', inside: 'medium', secret: 'critical', system: 'critical', volume: 'high', outside: 'high', broad: 'high' },
  move:   { temp: 'low', inside: 'medium', secret: 'critical', system: 'critical', volume: 'high', outside: 'high', broad: 'critical' },
  change: { temp: 'medium', inside: 'high', secret: 'critical', system: 'critical', volume: 'critical', outside: 'critical', broad: 'critical' }
};
const KIND_WORDS = { read: 'reads files', create: 'creates files', move: 'moves files', change: 'changes or deletes files' };
const KIND_OF = { read_file: 'read', list_folder: 'read', drive_find: 'read', drive_scan: 'read', drive_suggest: 'read', drive_propose: 'read', open_path: 'read', save_files: 'create', make_document: 'create', drive_make: 'create', drive_apply: 'move', drive_undo: 'move', trash_path: 'change' };
const PATH_KEYS = /^(?:path|paths|folder|from|to|to_folder|trash|file|files|dir)$/;

// ---- shell commands: what a command line may do, segment by segment ----
const CRITICAL = [
  [/\b(?:sudo|doas)\b/, 'runs with administrator rights'], [/\b(?:dd|mkfs(?:\.\w+)?|fdisk|newfs\w*)\b/, 'writes to a disk directly'], [/\bdiskutil\s+(?:erase|partition|zero|secure|apfs\s+delete)/i, 'erases a disk'],
  [/\brm\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+(?:--\s+)?(?:\/|~|\$HOME|\$\{HOME\}|\*|\.)(?:\s|$|\/\*)/, 'deletes a whole folder tree'], [/\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, 'runs downloaded code'],
  [/\b(?:launchctl\s+(?:load|bootstrap|enable|submit)|csrutil|spctl\s+--master|nvram|scutil\s+--set)\b/, 'changes how this Mac starts or is protected'], [/\b(?:chmod|chown)\s+-\w*R/, 'changes permissions of a whole folder tree'],
  [/\bcrontab\b/, 'schedules code to run later'], [/\bsecurity\s+(?:delete-|add-|import|export|dump-keychain|find-(?:generic|internet)-password)/, 'touches the keychain']
];
const HIGH = [
  [/\b(?:rm|rmdir|unlink|shred)\b/, 'deletes files'], [/\bmv\b/, 'moves or renames files'], [/\b(?:sed|perl)\s+(?:-\w*i)/, 'edits files in place'], [/\b(?:truncate|tee)\b/, 'overwrites files'],
  [/(?:^|[^&0-9>])>>?\s*[^&\s]/, 'writes to a file'], [/\b(?:chmod|chown)\b/, 'changes permissions'], [/\b(?:kill|killall|pkill)\b/, 'stops programs'],
  [/\bgit\s+(?:reset\s+--hard|clean\s+-\w*f|push\s+.*--force|checkout\s+--\s|branch\s+-D)/, 'discards work in git'], [/\bfind\b.*(?:-delete|-exec\s+rm)/, 'deletes files']
];
const MEDIUM = /\b(?:mkdir|touch|cp|ditto|zip|unzip|tar|gzip|gunzip|ln|rsync|curl|wget|git\s+(?:add|commit|pull|fetch|checkout|merge|clone)|npm\s+(?:install|i|ci)|pip3?\s+install|brew\s+install|make|swift|python3?|node)\b/;
const READ_ONLY = /^\s*(?:ls|cat|head|tail|less|more|grep|egrep|rg|ag|find|pwd|echo|printf|which|whereis|type|wc|du|df|stat|file|date|whoami|id|uname|sw_vers|uptime|ps|top|env|printenv|hostname|ifconfig|netstat|lsof|mdfind|mdls|tree|sort|uniq|diff|cmp|basename|dirname|realpath|readlink|git\s+(?:status|log|diff|show|branch|remote)|node\s+-v|npm\s+(?:-v|ls|list)|python3?\s+--version)\b/;

function shellKind(command) {
  let level = 'low', kind = 'read'; const why = [];
  const bump = (l, k, w) => {
    if (RANK[l] > RANK[level]) level = l;
    if (k === 'change') kind = 'change'; else if (k === 'create' && kind === 'read') kind = 'create';
    if (w && !why.includes(w)) why.push(w);
  };
  for (const [re, w] of CRITICAL) if (re.test(String(command || ''))) bump('critical', 'change', w); // some dangers span a pipe, so the whole line is checked first
  for (const seg of String(command || '').split(/&&|\|\||;|\n|\|/)) {
    if (!seg.trim()) continue;
    const c = CRITICAL.find(([re]) => re.test(seg)), h = HIGH.find(([re]) => re.test(seg));
    if (c) bump('critical', 'change', c[1]);
    else if (h) bump('high', 'change', h[1]);
    else if (READ_ONLY.test(seg)) { /* stays low */ }
    else if (MEDIUM.test(seg)) bump('medium', 'create', 'creates or changes files');
    else bump('medium', 'create', 'runs a program');
  }
  return { level, kind, why };
}

const callPaths = (tool, input) => {
  const found = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { if (PATH_KEYS.test(key || '')) found.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(input, '');
  if (tool === 'run_shell') found.push(...pathsIn(input?.command));
  if (tool === 'run_applescript') found.push(...pathsIn(input?.script));
  return found;
};

const MANY = 25;
// { level, reasons, paths } for a call that touches files, or null for a tool that does not.
function classifyCall(tool, input, { home }) {
  let kind = KIND_OF[tool], forced = 'low';
  const reasons = [];
  if (tool === 'run_shell') { const s = shellKind(input?.command); kind = s.kind; forced = s.level; reasons.push(...s.why); }
  else if (tool === 'run_applescript') {
    if (!/\b(?:delete|remove|erase|trash|empty trash|move to trash|do shell script|sudo)\b/i.test(String(input?.script || ''))) return null;
    kind = 'change'; forced = 'high'; reasons.push('deletes or runs commands through AppleScript');
  }
  if (!kind) return null;
  const paths = [...new Set(callPaths(tool, input))];
  let level = forced;
  const places = new Set();
  for (const p of paths.length ? paths : ['.']) {
    const cat = categorize(p, home);
    if (cat !== 'inside' && cat !== 'temp') places.add(cat);
    const l = TABLE[kind][cat];
    if (RANK[l] > RANK[level]) level = l;
  }
  if (RANK[TABLE[kind].inside] > RANK[level]) level = TABLE[kind].inside;
  if (!reasons.length) reasons.push(KIND_WORDS[kind]);
  for (const c of places) reasons.push(CAT_WORDS[c]);
  if (paths.length >= MANY && kind !== 'read') { level = LEVELS[Math.min(3, RANK[level] + 1)]; reasons.push(`${paths.length} items at once`); }
  return { level, reasons, paths: paths.slice(0, 5) };
}

// What the rule for this level says to do with this call.
function decide(level, rules) { return (rules && rules[level]) || DEFAULTS[level]; }

function levelQuestion(lv, action) {
  const where = lv.paths.length ? ` ${lv.paths.slice(0, 3).join(', ')}${lv.paths.length > 3 ? ' and more' : ''}.` : '';
  return `${TITLE[lv.level]} risk: ${lv.reasons.join('; ')}.${where}${action === 'ask-mac' ? ' This has to be approved at the Mac.' : ''} Go ahead?`;
}

// Wraps tools so each file-touching call is rated and its level's rule applied. Rules are read at each call, so Settings applies at once.
// A tool that already asks keeps asking; a rule can add a question (ask, ask-mac) or refuse the call (deny) and never removes one.
function levelTools(tools, { home, rules = () => DEFAULTS, enabled = () => true } = {}) {
  return tools.map((t) => {
    if (!t.input_schema) return t;
    if (!KIND_OF[t.name] && t.name !== 'run_shell' && t.name !== 'run_applescript') return t;
    const rate = (i) => {
      if (!enabled()) return null;
      let c; try { c = classifyCall(t.name, i, { home }); } catch { c = null; }
      return c ? { ...c, action: decide(c.level, rules()) } : null;
    };
    const orig = t.guarded ? t.origConfirm : t.confirm;
    return {
      ...t,
      guarded: true,
      origConfirm: orig,
      outsideHome: t.outsideHome || (() => []),
      levelOf: rate,
      levelBlock: (i) => { const lv = rate(i); return lv && lv.action !== 'allow' ? `Not done: this is ${TITLE[lv.level].toLowerCase()} risk (${lv.reasons.join('; ')}), and a background agent cannot ask first.` : null; },
      confirm: (i) => {
        const base = t.confirm ? t.confirm(i) : null, lv = rate(i);
        if (!lv || lv.action === 'allow' || lv.action === 'deny') return base;
        const q = levelQuestion(lv, lv.action);
        return base ? `${q}\n${base}` : q;
      },
      run: (i, ctx) => {
        const lv = rate(i);
        if (lv && lv.action === 'deny') return `Not done: your file permission rule for ${lv.level} risk is "never" (${lv.reasons.join('; ')}). Tell the user it was refused by that rule.`;
        return t.run(i, ctx);
      }
    };
  });
}

module.exports = { levelTools, classifyCall, categorize, shellKind, rulesFrom, decide, levelQuestion, LEVELS, ALLOWED, DEFAULTS, TITLE };
