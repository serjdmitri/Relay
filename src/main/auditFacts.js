// Gathers the facts securityAudit.js judges. Everything here only reads: macOS status commands, the in-memory settings, file permission modes.
// Nothing is changed and no secret value leaves this file (secrets are reported by where they are, never by what they say). Each source is
// injected, so the whole thing can be tested with fakes. A command that fails leaves its fact null, which the audit shows as "not checked".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const A = require('./securityAudit');
const { listeners } = require('./networkRadar');
const { parseFirewall, parseFileVault } = require('./doctor');

// stdout and stderr together: some of these tools (sysadminctl) print their answer to stderr.
const run = (file, args, ms = 4000) => new Promise((resolve) => execFile(file, args, { timeout: ms, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, out, se) => resolve({ ok: !err, text: `${out || ''}\n${se || ''}`.trim() })));

// Listening TCP ports from `netstat -an -p tcp`, which (unlike lsof) also shows sockets owned by other users such as sshd.
function parseListenPorts(text) {
  const ports = new Set();
  for (const line of String(text || '').split('\n')) {
    if (!/\bLISTEN\b/.test(line)) continue;
    const m = /^\s*tcp(?:46|4|6)?\s+\d+\s+\d+\s+(\S+)\s/.exec(line);
    const addr = m?.[1] || '';
    const port = Number(/[.:](\d+)$/.exec(addr)?.[1]);
    if (Number.isInteger(port) && !/^(?:127\.|localhost\.|::1\.|\[::1\])/.test(addr)) ports.add(port);
  }
  return ports;
}

const modeOf = (stat, p) => { try { return stat(p).mode & 0o777; } catch { return null; } };

async function gatherFacts({ exec = run, stat = fs.statSync, readFile = (p) => fs.readFileSync(p, 'utf8'), readdir = fs.readdirSync, user = os.userInfo().username, store, perms, phoneInfo, textsInfo, plugins, flagOn = () => false, fullDisk = () => false, safeStorage, home = '' } = {}) {
  const [sip, gk, fw, stealth, fv, lock, auto, upd, lsof, net] = await Promise.all([
    exec('/usr/bin/csrutil', ['status']), exec('/usr/sbin/spctl', ['--status']),
    exec('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']), exec('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getstealthmode']),
    exec('/usr/bin/fdesetup', ['status']), exec('/usr/sbin/sysadminctl', ['-screenLock', 'status']),
    exec('/usr/bin/defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser']), exec('/usr/sbin/softwareupdate', ['--schedule']),
    exec('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']), exec('/usr/sbin/netstat', ['-an', '-p', 'tcp'])
  ]);
  // macOS can hide this table from an app that has not been allowed to see the network; a Mac always has some listener, so an empty answer means hidden, not "nothing is listening".
  const ports = net.ok && /\bLISTEN\b/.test(net.text) ? parseListenPorts(net.text) : null;
  const answered = [sip, gk, fw, fv, lock].some((r) => r.ok);
  const desktop = answered ? {
    sip: sip.ok ? A.parseSip(sip.text) : null,
    gatekeeper: gk.ok ? A.parseGatekeeper(gk.text) : null,
    firewall: fw.ok ? parseFirewall(fw.text) : null,
    stealth: stealth.ok ? A.parseStealth(stealth.text) : null,
    filevault: fv.ok ? parseFileVault(fv.text) : 'unknown',
    screenLock: lock.ok ? A.parseScreenLock(lock.text) : null,
    autoLogin: auto.ok ? /\S/.test(auto.text) : /could not find key/i.test(auto.text) ? false : null,
    autoUpdates: upd.ok ? A.parseAutoUpdate(upd.text) : null,
    remoteLogin: ports ? ports.has(22) : null,
    screenSharing: ports ? ports.has(5900) : null,
    fileSharing: ports ? ports.has(445) || ports.has(548) : null
  } : null;

  const data = store?.data || {};
  const secrets = A.scanForSecrets(data);
  let encryptionAvailable = null;
  try { encryptionAvailable = safeStorage ? !!safeStorage.isEncryptionAvailable() : null; } catch { encryptionAvailable = null; }
  const credentials = store ? {
    encryptionAvailable, plain: secrets.plain, tokenShaped: secrets.tokenShaped, encrypted: secrets.encrypted,
    historyHits: A.countTokenRecords(data.actions) + A.countTokenRecords(data.history),
    fileMode: store.file ? modeOf(stat, store.file) : null, dirMode: store.file ? modeOf(stat, path.dirname(store.file)) : null
  } : null;

  let phone = null;
  try { const p = phoneInfo ? await phoneInfo() : null; if (p) phone = { enabled: !!p.enabled, running: !!p.running, lan: p.lan !== false, port: p.port, error: p.error || '', devices: p.devices || [], tailscaleServing: !!p.tailscale?.serving, pairingActive: !!p.pairingActive }; } catch { phone = null; }
  let texts = null;
  try { texts = textsInfo ? await textsInfo() : null; } catch { texts = null; }

  let permissions = null;
  try { permissions = perms ? { ...perms.status(), fullDisk: !!fullDisk() } : null; } catch { permissions = null; }
  const s = (k) => store?.get ? store.get(k) : undefined;
  const features = { camera: !!(s('settings.hands.enabled') || s('settings.presence.enabled')), messages: !!flagOn('imessage') };

  let pluginList = [];
  try { pluginList = (plugins?.list?.() || []).map((p) => ({ name: String(p.name || p.manifest?.name || 'plugin'), permissions: p.permissions || p.manifest?.permissions || {} })); } catch { pluginList = []; }
  const files = store ? { homeOnly: s('settings.homeOnly'), driveRoots: s('settings.driveRoots') || [], home, doctorFix: s('settings.doctor.fix') || 'ask', plugins: pluginList, pluginSandbox: plugins ? !!plugins.sandbox : undefined } : null;

  // Signs of compromise: where a foothold is usually left. Each source is read on its own, so one failing does not hide the rest.
  const [adm, prof, prox] = await Promise.all([exec('/usr/bin/dscl', ['.', '-read', '/Groups/admin', 'GroupMembership']), exec('/usr/bin/profiles', ['list']), exec('/usr/sbin/scutil', ['--proxy'])]);
  const tryRead = (fn) => { try { return fn(); } catch { return null; } };
  const hostsText = tryRead(() => readFile('/etc/hosts'));
  const dirs = [path.join(home || os.homedir(), 'Library/LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons'];
  const listed = dirs.map((d) => tryRead(() => readdir(d)));
  const launchItems = listed.every((l) => l === null) ? null : [...new Set(listed.flatMap((l) => l || []).filter((n) => /\.plist$/.test(n) && !/^com\.apple\./.test(n)).map((n) => n.replace(/\.plist$/, '')))].sort();
  const indicators = [adm, prof, prox].some((r) => r.ok) || hostsText != null || launchItems ? {
    currentUser: user,
    admins: adm.ok ? A.parseAdmins(adm.text) : null,
    profiles: prof.ok ? A.parseProfiles(prof.text) : null,
    proxy: prox.ok ? A.parseProxy(prox.text) : null,
    hosts: hostsText != null ? A.parseHosts(hostsText) : null,
    launchItems
  } : null;

  return { desktop, listeners: lsof.ok ? listeners(lsof.text) : null, phone, texts, credentials, permissions, features, files, indicators };
}

module.exports = { gatherFacts, parseListenPorts };
