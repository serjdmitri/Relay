// Deep security audit: reads facts about this Mac, Relay's phone access, its stored credentials, the permissions it holds and the file
// operations it may do, and says what is risky, why, and how to fix it. Read-only: nothing here changes a setting, and no secret value is
// ever returned (only where one was found). The facts are gathered elsewhere (auditFacts.js) and injected, so every check is a pure function
// that can be tested whole. A fact that could not be read is reported as "not checked", never as a pass.

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const AREAS = { desktop: 'Desktop', phone: 'Phone access', credentials: 'Credentials', permissions: 'Permissions', files: 'File operations', compromise: 'Signs of compromise' };

const find = (id, area, severity, title, detail, fix = '') => ({ id, area, severity, title, detail, fix });
const pass = (id, area, title) => ({ id, area, severity: 'pass', title });
const unknown = (id, area, title, why) => ({ id, area, severity: 'unknown', title, detail: why });
const list = (items, n = 6) => items.slice(0, n).join(', ') + (items.length > n ? ` and ${items.length - n} more` : '');
const DAY = 86400e3;

// ---- parsers for the macOS commands the facts come from (pure) ----
const parseSip = (t) => /enabled/i.test(t) ? true : /disabled/i.test(t) ? false : null;
const parseGatekeeper = (t) => /assessments enabled/i.test(t) ? true : /assessments disabled/i.test(t) ? false : null;
const parseStealth = (t) => /stealth mode is on/i.test(t) ? true : /stealth mode is off/i.test(t) ? false : null;
const parseAutoUpdate = (t) => /turned on/i.test(t) ? true : /turned off/i.test(t) ? false : null;
function parseScreenLock(t) {
  const s = String(t || '');
  if (/screenLock is off/i.test(s)) return { enabled: false, delaySec: null };
  if (/delay is immediate/i.test(s)) return { enabled: true, delaySec: 0 };
  const m = /delay is (\d+) second/i.exec(s);
  return m ? { enabled: true, delaySec: Number(m[1]) } : null;
}

// ---- sources for the "signs of compromise" checks (pure) ----
const parseAdmins = (t) => { const m = /GroupMembership:\s*(.*)/.exec(String(t || '')); return m ? m[1].trim().split(/\s+/).filter(Boolean) : null; };
function parseProfiles(t) {
  const s = String(t || '');
  if (/requires root|not permitted|error/i.test(s) && !/profileIdentifier|configuration profiles? installed/i.test(s)) return null;
  const ids = [...s.matchAll(/profileIdentifier:\s*(\S+)/g)].map((m) => m[1]);
  const m = /There (?:are|is) (\d+) (?:user |computer |device )?configuration profiles? installed/i.exec(s);
  if (m) return { count: Number(m[1]), ids };
  return /no configuration profiles installed/i.test(s) ? { count: 0, ids: [] } : ids.length ? { count: ids.length, ids } : null;
}
function parseProxy(t) {
  const s = String(t || '');
  if (!/<dictionary>/.test(s)) return null;
  return ['HTTPEnable', 'HTTPSEnable', 'SOCKSEnable', 'ProxyAutoConfigEnable'].filter((k) => new RegExp(`\\b${k}\\s*:\\s*1\\b`).test(s)).map((k) => k.replace('Enable', ''));
}
function parseHosts(t) {
  const defaults = /^(?:127\.0\.0\.1\s+localhost|255\.255\.255\.255\s+broadcasthost|::1\s+localhost)\s*$/i;
  const extra = [];
  for (const raw of String(t || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || defaults.test(line)) continue;
    const [ip, ...names] = line.split(/\s+/);
    if (ip && names.length) extra.push(...names.map((n) => `${n} -> ${ip}`));
  }
  return extra;
}

// ---- secret scanning: where a secret sits unprotected, never its value ----
const TOKEN_SHAPES = [/\bsk-[A-Za-z0-9_-]{20,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bhf_[A-Za-z0-9]{30,}/, /\bsecret_[A-Za-z0-9]{30,}/, /\bBearer\s+[A-Za-z0-9._-]{24,}/i, /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/];
const looksLikeToken = (s) => typeof s === 'string' && s.length >= 20 && TOKEN_SHAPES.some((re) => re.test(s));
function scanForSecrets(data, { skip = ['actions', 'history', 'remoteDevices'], maxNodes = 60000 } = {}) {
  const out = { plain: [], tokenShaped: [], encrypted: [] };
  let seen = 0;
  const walk = (v, path, depth) => {
    if (seen++ > maxNodes || depth > 8 || v == null) return;
    if (typeof v === 'string') {
      const key = path.split('.').pop();
      if (v.startsWith('plain:')) out.plain.push(path);
      else if (looksLikeToken(v)) out.tokenShaped.push(path);
      else if (/Enc$/.test(key) && v) out.encrypted.push(path);
      return;
    }
    if (Array.isArray(v)) { v.slice(0, 200).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (depth === 0 && skip.includes(k)) continue; walk(x, path ? `${path}.${k}` : k, depth + 1); }
  };
  walk(data, '', 0);
  return out;
}
// How many records (history, action results) hold something that looks like a secret. Counts only.
function countTokenRecords(records) {
  let n = 0;
  for (const r of (Array.isArray(records) ? records : []).slice(0, 2000)) { if (looksLikeToken(typeof r === 'string' ? r : JSON.stringify(r || ''))) n++; }
  return n;
}

const BROAD_ROOTS = new Set(['/', '/users', '/system', '/library', '/etc', '/private', '/usr', '/bin', '/sbin', '/var', '/applications', '/volumes']);
const norm = (p) => String(p || '').replace(/\/+$/, '').toLowerCase() || '/';

// ---- the checks: each takes the facts and returns results ----
const CHECKS = [
  // Desktop
  (f) => {
    const d = f.desktop; if (!d) return [unknown('desktop', 'desktop', 'Desktop settings', 'The Mac did not answer any of the desktop checks.')];
    const r = [];
    if (d.sip === false) r.push(find('sip-off', 'desktop', 'critical', 'System Integrity Protection is off', 'macOS\'s protection for its own files and processes is disabled, so any program running as you or as an administrator can alter the system.', 'Restart into Recovery, open Terminal and run csrutil enable. Leave it on unless you are developing system software.'));
    else if (d.sip === true) r.push(pass('sip', 'desktop', 'System Integrity Protection is on')); else r.push(unknown('sip', 'desktop', 'System Integrity Protection', 'csrutil gave no answer.'));
    if (d.filevault === 'off') r.push(find('filevault-off', 'desktop', 'high', 'FileVault disk encryption is off', 'If this Mac is lost or stolen, whoever has it can read your files, saved sign-ins and Relay\'s data by taking the disk out.', 'System Settings > Privacy & Security > FileVault > Turn On. Keep the recovery key somewhere other than this Mac.'));
    else if (d.filevault === 'on') r.push(pass('filevault', 'desktop', 'FileVault is on')); else r.push(unknown('filevault', 'desktop', 'FileVault', 'fdesetup gave no answer.'));
    if (d.firewall === 0) r.push(find('firewall-off', 'desktop', 'medium', 'The macOS firewall is off', 'Programs on this Mac that listen for connections, including Relay\'s phone access when it is on, accept them from every device on the same network.', 'System Settings > Network > Firewall > turn it on.'));
    else if (d.firewall === 1 || d.firewall === 2) {
      r.push(pass('firewall', 'desktop', 'The macOS firewall is on'));
      if (d.stealth === false) r.push(find('stealth-off', 'desktop', 'low', 'Firewall stealth mode is off', 'This Mac answers probes such as ping and connection attempts on closed ports, which makes it easier to find on a shared network.', 'System Settings > Network > Firewall > Options > Enable stealth mode.'));
    } else r.push(unknown('firewall', 'desktop', 'The macOS firewall', 'socketfilterfw gave no answer.'));
    if (d.gatekeeper === false) r.push(find('gatekeeper-off', 'desktop', 'high', 'Gatekeeper is off', 'macOS will open apps from anywhere without checking them first.', 'Run sudo spctl --global-enable in Terminal.'));
    else if (d.gatekeeper === true) r.push(pass('gatekeeper', 'desktop', 'Gatekeeper is on')); else r.push(unknown('gatekeeper', 'desktop', 'Gatekeeper', 'spctl gave no answer.'));
    if (d.autoLogin === true) r.push(find('auto-login', 'desktop', 'high', 'Automatic login is on', 'Anyone who starts this Mac gets straight into your account without a password.', 'System Settings > Users & Groups > Automatically log in as > Off.'));
    else if (d.autoLogin === false) r.push(pass('auto-login', 'desktop', 'Automatic login is off'));
    if (d.screenLock) {
      if (!d.screenLock.enabled) r.push(find('screen-lock-off', 'desktop', 'high', 'The screen does not lock', 'Nothing asks for a password when you walk away from an unlocked Mac.', 'System Settings > Lock Screen > Require password after screen saver begins or display is turned off > Immediately.'));
      else if (d.screenLock.delaySec > 300) r.push(find('screen-lock-slow', 'desktop', 'medium', `The screen waits ${Math.round(d.screenLock.delaySec / 60)} minutes before asking for a password`, 'Someone who reaches the Mac within that time finds it unlocked.', 'System Settings > Lock Screen > set the password requirement to Immediately or 5 seconds.'));
      else if (d.screenLock.delaySec > 60) r.push(find('screen-lock-slow', 'desktop', 'low', `The screen waits ${d.screenLock.delaySec} seconds before asking for a password`, 'A short window after the screen sleeps in which the Mac stays unlocked.', 'System Settings > Lock Screen > Immediately.'));
      else r.push(pass('screen-lock', 'desktop', 'The screen locks promptly'));
    } else r.push(unknown('screen-lock', 'desktop', 'Screen lock', 'sysadminctl gave no answer.'));
    if (d.remoteLogin == null && d.screenSharing == null && d.fileSharing == null) r.push(unknown('sharing', 'desktop', 'Remote Login, Screen Sharing and File Sharing', 'macOS did not show Relay which ports are listening, so these could not be checked. Look under System Settings > General > Sharing.'));
    else if (!d.remoteLogin && !d.screenSharing && !d.fileSharing) r.push(pass('sharing', 'desktop', 'Remote Login, Screen Sharing and File Sharing are off'));
    if (d.remoteLogin) r.push(find('ssh-on', 'desktop', 'medium', 'Remote Login (SSH) is on', 'Another computer on the network can try to sign in to this Mac with your account name and password.', 'System Settings > General > Sharing > Remote Login > Off, unless you use it.'));
    if (d.screenSharing) r.push(find('screen-sharing-on', 'desktop', 'medium', 'Screen Sharing is on', 'Other computers on the network can try to view and control this screen.', 'System Settings > General > Sharing > Screen Sharing > Off, unless you use it.'));
    if (d.fileSharing) r.push(find('file-sharing-on', 'desktop', 'low', 'File Sharing is on', 'Folders on this Mac are offered to other devices on the network.', 'System Settings > General > Sharing > File Sharing > Off, unless you use it.'));
    if (d.autoUpdates === false) r.push(find('updates-off', 'desktop', 'low', 'Automatic update checks are off', 'Security fixes for macOS wait until you look for them yourself.', 'System Settings > General > Software Update > Automatic updates.'));
    else if (d.autoUpdates === true) r.push(pass('updates', 'desktop', 'macOS checks for updates by itself'));
    return r;
  },
  (f) => {
    const l = f.listeners; if (!Array.isArray(l)) return [unknown('listeners', 'desktop', 'Programs listening for connections', 'lsof gave no answer.')];
    const wide = l.filter((s) => !s.localOnly && !['sharingd', 'rapportd', 'ControlCe', 'ControlCenter', 'identitys', 'WiFiAgent', 'Relay', 'Electron'].includes(s.process));
    if (!wide.length) return [pass('listeners', 'desktop', 'Nothing unexpected listens beyond this Mac')];
    const names = [...new Set(wide.map((s) => `${s.process}:${s.port}`))];
    return [find('listeners-wide', 'desktop', 'low', `${names.length} program${names.length === 1 ? '' : 's'} accept connections from the network`, `${list(names)}. Each one can be reached by other devices on the same network while it runs (a development server left running is the usual cause).`, 'Quit the ones you do not recognize, or bind them to localhost.')];
  },
  // Phone access
  (f) => {
    const p = f.phone; if (!p) return [unknown('phone', 'phone', 'Phone access', 'Relay could not report its phone access state.')];
    const r = [];
    const devices = p.devices || [];
    if (!p.enabled && !p.running) r.push(pass('phone-off', 'phone', 'Phone access is off: Relay is not listening for phones'));
    else {
      if (p.running && p.lan) r.push(find('phone-http', 'phone', 'medium', `Phone access listens on your network over plain HTTP (port ${p.port})`, 'Only addresses on a home network, this Mac or Tailscale are accepted, but the page and the phone\'s sign-in token travel unencrypted, so someone else on the same Wi-Fi (a school or café network, for example) could read them.', 'Use it only on a network you trust, or turn off "Allow on my network" and use Tailscale, which encrypts the connection.'));
      else if (p.running) r.push(pass('phone-local', 'phone', 'Phone access is limited to this Mac'));
      if (p.error) r.push(find('phone-error', 'phone', 'info', 'Phone access reported a problem', String(p.error).slice(0, 200)));
      if (p.pairingActive) r.push(find('phone-pairing', 'phone', 'info', 'A pairing code is open right now', 'It lasts five minutes and works once. If you are not pairing a phone, close it.', 'Settings > Phone > Cancel pairing.'));
      if (p.tailscaleServing) r.push(find('phone-tailscale', 'phone', 'info', 'Phone access is shared through Tailscale', 'It is reachable by devices signed in to your tailnet, over an encrypted connection.'));
    }
    const now = f.now || Date.now();
    const stale = devices.filter((d) => d.lastSeen && now - d.lastSeen > 30 * DAY);
    const never = devices.filter((d) => !d.lastSeen);
    if (stale.length) r.push(find('phone-stale', 'phone', 'low', `${stale.length} paired phone${stale.length === 1 ? '' : 's'} not used for over 30 days`, `${list(stale.map((d) => d.name || 'Unnamed'))}. A paired phone keeps its access until you remove it, so a lost one still works.`, 'Settings > Phone > remove the ones you no longer use.'));
    if (never.length) r.push(find('phone-never', 'phone', 'low', `${never.length} paired device${never.length === 1 ? '' : 's'} never used`, list(never.map((d) => d.name || 'Unnamed')), 'Remove it if you did not create it.'));
    if (devices.length && !stale.length && !never.length) r.push(pass('phone-devices', 'phone', `${devices.length} paired device${devices.length === 1 ? '' : 's'}, all used in the last 30 days`));
    if (devices.some((d) => /shortcut/i.test(d.name || ''))) r.push(find('phone-shortcut', 'phone', 'info', 'A Siri Shortcut token exists', 'It is a long-lived sign-in that sits inside the Shortcut on your phone; anyone who can open that Shortcut can use it.', 'Remove it in Settings > Phone if you do not use it.'));
    const t = f.texts;
    if (t?.on && t.paired) r.push(find('texts-on', 'phone', 'info', 'Relay takes commands by text from your paired address', 'Risky actions are also asked on the phone, and the first answer wins, so anyone who controls that iMessage account can approve them.', 'Keep that Apple ID protected with two-factor authentication.'));
    else if (t?.on) r.push(find('texts-unpaired', 'phone', 'low', 'Texts are switched on but not paired', 'Nothing is accepted until a phone is paired, which is the safe state; turn it off if you do not use it.'));
    return r;
  },
  // Credentials
  (f) => {
    const c = f.credentials; if (!c) return [unknown('credentials', 'credentials', 'Stored credentials', 'Relay could not inspect its own settings.')];
    const r = [];
    if (c.encryptionAvailable === false) r.push(find('secure-storage', 'credentials', 'high', 'macOS secure storage is unavailable to Relay', 'Relay refuses to save new keys while this is true, but anything already saved cannot be read either.', 'Unlock your login keychain (Keychain Access), then restart Relay.'));
    if (c.plain?.length) r.push(find('plaintext-secrets', 'credentials', 'high', `${c.plain.length} secret${c.plain.length === 1 ? ' is' : 's are'} stored without encryption`, `In Relay's settings file: ${list(c.plain)}. Anyone or anything that can read that file can read them.`, 'Enter each one again in Settings so it is saved in secure storage, then rotate it at the service that issued it.'));
    if (c.tokenShaped?.length) r.push(find('token-in-settings', 'credentials', 'high', `${c.tokenShaped.length} value${c.tokenShaped.length === 1 ? '' : 's'} in settings look like keys or tokens`, `Found at: ${list(c.tokenShaped)}. Values are not shown here.`, 'Remove them from the settings file, enter them through Settings so they are encrypted, and rotate them.'));
    if (c.historyHits > 0) r.push(find('token-in-history', 'credentials', 'medium', `${c.historyHits} past request${c.historyHits === 1 ? '' : 's'} or result${c.historyHits === 1 ? '' : 's'} contain something that looks like a key`, 'Relay keeps a history of what you asked and what tools returned, so a key you spoke, pasted or that a tool printed may be stored in readable form.', 'Clear History in Settings, and rotate any key you pasted into a request.'));
    if (c.dirMode != null && (c.dirMode & 0o077)) r.push(find('data-dir-open', 'credentials', 'high', 'Relay\'s data folder can be read by other accounts on this Mac', `Its permissions are ${(c.dirMode & 0o777).toString(8)}.`, 'In Terminal: chmod 700 on the folder ~/Library/Application Support/Relay.'));
    if (c.fileMode != null && (c.fileMode & 0o077) && !(c.dirMode != null && (c.dirMode & 0o077))) r.push(find('data-file-open', 'credentials', 'low', 'Relay\'s settings file is readable by group or others', `Its permissions are ${(c.fileMode & 0o777).toString(8)}. Its folder is private, so other accounts cannot reach it today, but the file would be exposed if it were copied elsewhere.`, 'In Terminal: chmod 600 ~/Library/Application\\ Support/Relay/relay.json'));
    if (!c.plain?.length && !c.tokenShaped?.length && c.encryptionAvailable !== false) r.push(pass('secrets-encrypted', 'credentials', c.encrypted?.length ? `${c.encrypted.length} saved secret${c.encrypted.length === 1 ? ' is' : 's are'} encrypted, and no plaintext keys were found in settings` : 'No plaintext keys were found in settings'));
    if (c.historyHits === 0) r.push(pass('history-clean', 'credentials', 'No key-shaped text found in history'));
    return r;
  },
  // Permissions
  (f) => {
    const p = f.permissions; if (!p) return [unknown('permissions', 'permissions', 'macOS permissions', 'Relay could not read its permissions.')];
    const r = [], on = f.features || {};
    const granted = [];
    if (p.accessibility) granted.push('Accessibility (control any app, read what is on screen)');
    if (p.screen) granted.push('Screen Recording (see everything on screen)');
    if (p.fullDisk) granted.push('Full Disk Access (read every file, including Mail and Messages)');
    if (p.camera && !on.camera) r.push(find('perm-camera-unused', 'permissions', 'low', 'Camera access is granted but no Relay feature using it is on', 'Hands and Presence are both off, so the permission is not needed.', 'System Settings > Privacy & Security > Camera > Relay > Off.'));
    if (p.fullDisk && !on.messages) r.push(find('perm-fulldisk', 'permissions', 'medium', 'Full Disk Access is granted', 'Relay (and anything it runs) can read every file on this Mac. It is only needed to read Messages for text commands, which are off.', 'System Settings > Privacy & Security > Full Disk Access > Relay > Off.'));
    if (granted.length >= 3) r.push(find('perm-combo', 'permissions', 'medium', 'Relay holds the three most powerful permissions together', `${list(granted)}. With all three, a mistake or a malicious plugin could see and change nearly anything.`, 'Keep only the ones you use, and review them in System Settings > Privacy & Security.'));
    else if (granted.length) r.push(find('perm-granted', 'permissions', 'info', `Relay has ${granted.length} high-trust permission${granted.length === 1 ? '' : 's'}`, list(granted)));
    if (p.input) r.push(find('perm-input', 'permissions', 'info', 'Input Monitoring is granted', 'Relay can see keystrokes and clicks, which hotkeys and hand control use.'));
    if (!r.some((x) => x.severity !== 'info') && !granted.length) r.push(pass('permissions', 'permissions', 'Relay holds no high-trust permissions'));
    else if (!r.some((x) => RANK[x.severity] >= 1)) r.push(pass('permissions-fit', 'permissions', 'No granted permission looks unused'));
    return r;
  },
  // File operations
  (f) => {
    const x = f.files; if (!x) return [unknown('files', 'files', 'File operations', 'Relay could not report its file settings.')];
    const r = [];
    if (x.homeOnly === false) r.push(find('home-only-off', 'files', 'high', '"Ask before touching anything outside my home folder" is off', 'Tools can read, move or open files in /Applications, /etc and other drives without asking you first.', 'Settings > Files > turn on the home folder guard.'));
    else if (x.homeOnly === true) r.push(pass('home-only', 'files', 'Relay asks before touching anything outside your home folder'));
    const home = norm(x.home);
    const broad = (x.driveRoots || []).filter((p) => BROAD_ROOTS.has(norm(p)));
    const homeRoot = (x.driveRoots || []).filter((p) => norm(p) === home);
    if (broad.length) r.push(find('roots-broad', 'files', 'high', `${broad.length} folder${broad.length === 1 ? '' : 's'} granted to file tools cover system or whole-drive locations`, `${list(broad)}. Organizing or moving files there can break macOS or other apps.`, 'Settings > Files > remove them and grant only the folders you want organized.'));
    if (homeRoot.length) r.push(find('roots-home', 'files', 'medium', 'Your whole home folder is granted to file tools', 'Every file in it can be searched, moved or trashed by an organizing request.', 'Grant individual folders such as Downloads or Documents instead.'));
    if (x.driveRoots && !broad.length && !homeRoot.length) r.push(pass('roots', 'files', x.driveRoots.length ? `File tools are limited to ${x.driveRoots.length} chosen folder${x.driveRoots.length === 1 ? '' : 's'}` : 'No extra folders are granted to file tools'));
    if (x.doctorFix === 'small') r.push(find('doctor-small', 'files', 'low', 'Relay Doctor applies small fixes without asking', 'Fixes it rates as small run on their own when a check fails.', 'Settings > Doctor > set fixes to "Ask me first" if you want to approve each one.'));
    for (const pl of x.plugins || []) {
      const p = pl.permissions || {};
      if (p.shell) r.push(find(`plugin-shell-${pl.name}`, 'files', 'high', `Plugin "${pl.name}" can run shell commands`, 'It can run any program as you, so the sandbox is the only thing between it and your files.', 'Remove it unless you wrote it or fully trust it.'));
      if (p.acts) r.push(find(`plugin-acts-${pl.name}`, 'files', 'medium', `Plugin "${pl.name}" can act in your apps`, 'It can click and type for you.', 'Remove it if you do not need that.'));
      if (p.screen) r.push(find(`plugin-screen-${pl.name}`, 'files', 'medium', `Plugin "${pl.name}" can see your screen`, 'It can read anything displayed, including private messages.', 'Remove it if you do not need that.'));
      const writes = (p.files || []).filter((q) => q.mode && q.mode !== 'read');
      if (writes.length) r.push(find(`plugin-write-${pl.name}`, 'files', 'medium', `Plugin "${pl.name}" can change files`, `It may write to ${list(writes.map((q) => q.path))}.`, 'Check those folders are ones you are happy for it to change.'));
    }
    if ((x.plugins || []).length && x.pluginSandbox === false) r.push(find('plugin-sandbox', 'files', 'medium', 'Plugins run without a sandbox', 'macOS could not sandbox them, so they run with your full access.', 'Remove plugins you do not fully trust.'));
    else if ((x.plugins || []).length && !r.some((q) => q.id.startsWith('plugin-'))) r.push(pass('plugins', 'files', `${x.plugins.length} plugin${x.plugins.length === 1 ? '' : 's'} installed, none with shell, screen or write access`));
    return r;
  }
  ,
  // Signs of compromise: the usual places something leaves a foothold. These look for common signs; they cannot prove a Mac is clean.
  (f) => {
    const i = f.indicators; if (!i) return [unknown('indicators', 'compromise', 'Signs of compromise', 'The Mac did not answer any of these checks.')];
    const r = [];
    if (Array.isArray(i.admins)) {
      const others = i.admins.filter((n) => n !== 'root' && n !== i.currentUser && !n.startsWith('_'));
      if (others.length) r.push(find('extra-admin', 'compromise', 'medium', `${others.length === 1 ? 'Another administrator account exists' : `${others.length} other administrator accounts exist`}: ${list(others)}`, 'An extra administrator is a common way to keep access to a Mac. If you or a family member made it, that is fine.', 'System Settings > Users & Groups: remove or demote any account you do not recognize.'));
      else r.push(pass('admins', 'compromise', 'You are the only administrator account'));
    } else r.push(unknown('admins', 'compromise', 'Administrator accounts', 'dscl gave no answer.'));
    if (i.profiles) {
      if (i.profiles.count > 0) r.push(find('profiles', 'compromise', 'low', `${i.profiles.count} configuration profile${i.profiles.count === 1 ? ' is' : 's are'} installed`, `${list(i.profiles.ids.map((x) => x.replace(/\.[0-9A-F]{8}-[0-9A-F-]+$/i, '')))}. A profile can set restrictions, a proxy or trusted certificates. Screen Time and school or work management install them legitimately.`, 'System Settings > General > Device Management (or Profiles): remove any you do not recognize.'));
      else r.push(pass('profiles', 'compromise', 'No configuration profiles are installed'));
    } else r.push(unknown('profiles', 'compromise', 'Configuration profiles', 'profiles gave no answer.'));
    if (Array.isArray(i.proxy)) {
      if (i.proxy.length) r.push(find('proxy', 'compromise', 'medium', `Network traffic is set to go through a proxy (${list(i.proxy)})`, 'A proxy sees, and can change, what you send. A VPN, school or work network sets one legitimately; malware sets one to watch you.', 'System Settings > Network > your connection > Details > Proxies: turn off any you did not set up.'));
      else r.push(pass('proxy', 'compromise', 'No network proxy is set'));
    } else r.push(unknown('proxy', 'compromise', 'Network proxy', 'scutil gave no answer.'));
    if (Array.isArray(i.hosts)) {
      if (i.hosts.length) r.push(find('hosts', 'compromise', 'low', `The hosts file redirects ${i.hosts.length} name${i.hosts.length === 1 ? '' : 's'}`, `${list(i.hosts)}. A website can be sent somewhere else this way, to a fake login page for example.`, 'Remove entries you did not add: sudo nano /etc/hosts'));
      else r.push(pass('hosts', 'compromise', 'The hosts file has no redirects'));
    }
    if (Array.isArray(i.launchItems)) {
      if (i.launchItems.length) r.push(find('launch-items', 'compromise', 'info', `${i.launchItems.length} third-party program${i.launchItems.length === 1 ? '' : 's'} start in the background`, `${list(i.launchItems, 10)}. Updaters for apps you installed are normal; anything you do not recognize is worth a look.`, 'System Settings > General > Login Items & Extensions.'));
      else r.push(pass('launch-items', 'compromise', 'No third-party programs start in the background'));
    }
    return r;
  }
];

function runAudit(facts, { now = Date.now() } = {}) {
  const f = { ...facts, now };
  const all = [];
  for (const check of CHECKS) { try { all.push(...check(f)); } catch (e) { all.push(unknown('check-failed', 'desktop', 'A check could not finish', String(e.message || e).slice(0, 160))); } }
  const findings = all.filter((r) => SEVERITIES.includes(r.severity)).sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const passed = all.filter((r) => r.severity === 'pass');
  const notChecked = all.filter((r) => r.severity === 'unknown');
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((x) => x.severity === s).length]));
  return { at: now, findings, passed, notChecked, counts, areas: AREAS };
}

function summarize(report) {
  const c = report.counts, bad = ['critical', 'high', 'medium', 'low'].filter((s) => c[s]).map((s) => `${c[s]} ${s}`);
  const top = report.findings.find((x) => RANK[x.severity] >= 1);
  const gaps = report.notChecked.length ? ` ${report.notChecked.length} check${report.notChecked.length === 1 ? ' was' : 's were'} not readable, so ${report.notChecked.length === 1 ? 'it is' : 'they are'} not counted as passed.` : '';
  if (!bad.length) return `The security audit found nothing to fix. ${report.passed.length} checks passed.${gaps}`;
  return `The security audit found ${bad.join(', ')}. The most important: ${top.title}.${gaps}`;
}

// A plain-text copy for sharing. Contains where problems are, never a secret value.
function buildReport(report, { version = '' } = {}) {
  const lines = [`Relay security audit${version ? ` (Relay ${version})` : ''}, ${new Date(report.at).toISOString()}`, ''];
  for (const area of Object.keys(AREAS)) {
    const here = report.findings.filter((x) => x.area === area);
    lines.push(`${AREAS[area].toUpperCase()}`);
    if (!here.length) lines.push('  nothing to fix');
    for (const x of here) { lines.push(`  [${x.severity.toUpperCase()}] ${x.title}`); if (x.detail) lines.push(`      ${x.detail}`); if (x.fix) lines.push(`      Fix: ${x.fix}`); }
    lines.push('');
  }
  if (report.notChecked.length) { lines.push('NOT CHECKED'); for (const x of report.notChecked) lines.push(`  ${x.title}: ${x.detail}`); lines.push(''); }
  lines.push(`${report.passed.length} checks passed.`);
  lines.push('These checks look for common risks and signs of a problem. They cannot prove a Mac is free of malware.');
  return lines.join('\n');
}

// "check my security", "is my mac safe", "has anything been compromised", "security status": any short request that is about this Mac's or Relay's security.
const NOT_ABOUT_THE_MAC = /\b(?:camera|cameras|guard|guards|council|deposit|clearance|alarm|door|doors|essay|article|news|stock|stocks|job|jobs|degree|class|course|homework|movie|game|book|meme|joke|password|passwords|passcode|wifi password|wi-fi password)\b/i;
function parseAuditCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  if (!n || n.split(' ').length > 14 || NOT_ABOUT_THE_MAC.test(n) || /^(?:open|launch|go to)\b/.test(n)) return false;
  return /\b(?:security|safety) (?:audit|check|review|scan|status|report|warnings?|alerts?|problems?|issues?|risks?|holes?|health|posture|overview|summary)\b/.test(n)
    || /^(?:check|show|run|do|give me|tell me|review|audit|scan|test|look at|what(?:'s| is))(?: me)?(?: a| an| the| my| our| this)? ?(?:deep |full |complete |thorough |quick )?(?:my |the |this )?(?:mac(?:'s)? |computer(?:'s)? |laptop(?:'s)? |relay(?:'s)? |system(?:'s)? )?(?:security|safety)$/.test(n)
    || /^(?:audit|check|review|scan) (?:my |the |this )?(?:mac|computer|laptop|relay|system|setup)(?:'s)? (?:security|safety)$/.test(n)
    || /\b(?:am i|are we) (?:safe|secure|compromised|hacked|protected|at risk)\b/.test(n)
    || /\b(?:is|are) (?:my |this |the )?(?:mac|computer|laptop|relay|system|setup|phone access|account|accounts|network)(?: \w+)? (?:safe|secure|compromised|hacked|breached|infected|at risk|protected)\b/.test(n)
    || /\bhas (?:my |this |the )?(?:mac|computer|laptop|relay|system|account|accounts)(?: \w+)? been (?:hacked|compromised|breached|infected)\b/.test(n)
    || /\bhow secure (?:is|are) (?:my |this |the )?(?:mac|computer|laptop|relay|system|setup|phone access|network)\b/.test(n)
    || /\b(?:is there|are there|is) (?:anything|any|something|what)(?: that(?:'s| is))? ?(?:compromised|hacked|exposed|at risk|insecure|vulnerable|unsafe|wrong with my security)\b/.test(n)
    || /^what(?:'s| is| are) (?:compromised|exposed|at risk|insecure|vulnerable|unsafe)\b/.test(n)
    || /^(?:any|are there any|do i have any) (?:security )?(?:warnings|threats|vulnerabilities|risks)\b/.test(n);
}

// "turn off security warnings" / "warn me about security problems": returns true (on), false (off) or null.
function parseWatchCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/[.!?]+$/, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/\s+/g, ' ').toLowerCase();
  if (/^(?:turn off|switch off|stop|disable|mute|no more|don'?t (?:give me|send me|show me)|stop giving me) (?:the )?(?:security )?(?:warnings|alerts|security warnings|security alerts)$/.test(n) || /^(?:stop|don'?t) warn(?:ing)? me about (?:my )?security(?: problems| issues| things)?$/.test(n)) return false;
  if (/^(?:turn on|switch on|enable|start|resume|keep) (?:the )?(?:security )?(?:warnings|alerts|security warnings|security alerts)$/.test(n) || /^(?:warn me about|alert me to|tell me about|keep an eye on|watch) (?:my )?(?:security|security problems|security issues)(?: for me)?$/.test(n)) return true;
  return null;
}

// Which findings are new since the last check and worth interrupting you for. state: { alerted: { "id|severity": time } }.
// A finding is told once, then again after a week if it is still critical or high; one that goes away and comes back is new again.
function selectWarnings(report, state, { min = 'medium', now = Date.now(), remindDays = 7, cap = 3 } = {}) {
  const old = (state && state.alerted) || {}, alerted = {}, fresh = [];
  for (const x of report.findings) {
    if (RANK[x.severity] < (RANK[min] ?? 2)) continue;
    const key = `${x.id}|${x.severity}`, at = old[key];
    const remind = at && RANK[x.severity] >= 3 && now - at > remindDays * DAY;
    if (!at || remind) { fresh.push(x); alerted[key] = now; } else alerted[key] = at;
  }
  return { warn: fresh.slice(0, cap), more: Math.max(0, fresh.length - cap), state: { alerted } };
}

module.exports = { runAudit, summarize, buildReport, parseAuditCommand, parseWatchCommand, selectWarnings, parseAdmins, parseProfiles, parseProxy, parseHosts, scanForSecrets, countTokenRecords, looksLikeToken, parseSip, parseGatekeeper, parseStealth, parseAutoUpdate, parseScreenLock, SEVERITIES, AREAS, CHECKS };
