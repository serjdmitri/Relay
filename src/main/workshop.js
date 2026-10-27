// Workshop mode, for teaching younger students: a calm, slower voice, short simple wording, and hologram demos of how common attacks and defences work
// ("show me how phishing works"). The demos are built from labelled shapes here, so they appear at once with no model and no internet. Pure.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---- building a demo from labelled nodes and the links between them (all in one plane, a little deep so it turns nicely) ----
const COLORS = { you: '#4cc2ff', bad: '#ff5a4f', good: '#5be584', warn: '#ffb347', neutral: '#c9d6df', data: '#ffe066' };
const node = (shape, size, position, color, label, extra = {}) => ({ shape, size, position, rotation: [0, 0, 0], color, glow: true, ...(label ? { label } : {}), ...extra });
const link = (a, b, color = '#59dcff') => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] || 0) - (a[2] || 0);
  const len = Math.hypot(dx, dy, dz);
  return { shape: 'cylinder', size: [0.022, 0.022, +len.toFixed(3)], position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] || 0) + (b[2] || 0)) / 2], rotation: [0, 0, +(-Math.atan2(dx, dy) * 180 / Math.PI).toFixed(2)], color, glow: true };
};
const at = (p, t) => [p[0] + (t[0] - p[0]) * 0.5, p[1] + (t[1] - p[1]) * 0.5, 0]; // the middle of two points

const DEMOS = {
  phishing: {
    title: 'How phishing works', names: ['phishing', 'a phishing attack', 'phishing email', 'phishing emails', 'a phishing email', 'fishing emails', 'scam emails'],
    explain: 'Phishing is a trick. The attacker, in red, sends you a fake email that looks real and says hurry. You click and see a fake login page that looks like the real one. When you type your password, the attacker gets it. The fix: check the sender and the link, and never type a password after clicking from an email.',
    build() {
      const A = [-1.1, 0.8, 0], E = [1.1, 0.8, 0], Y = [1.1, -0.8, 0], P = [-1.1, -0.8, 0];
      return [node('cone', [0.28, 0.5], A, COLORS.bad, 'Attacker'), node('box', [0.5, 0.34, 0.08], E, COLORS.warn, 'Fake email'), node('sphere', [0.26], Y, COLORS.you, 'You'), node('box', [0.5, 0.4, 0.08], P, COLORS.bad, 'Fake login page'), link(A, E, COLORS.bad), link(E, Y, COLORS.warn), link(Y, P, COLORS.warn), link(P, A, COLORS.data), node('sphere', [0.07], at(P, A), COLORS.data, 'Your password')];
    }
  },
  'man in the middle': {
    title: 'How a man-in-the-middle attack works', names: ['man in the middle', 'a man in the middle attack', 'mitm', 'a mitm attack', 'man in the middle attack', 'eavesdropping'],
    explain: 'You send a message to a website. But the attacker sits in the middle, on the same open Wi-Fi. They read your message, maybe change it, and pass it on, so neither side notices. The fix: use websites that start with https, which scrambles the message, and avoid logging in on open Wi-Fi.',
    build() {
      const Y = [-1.2, 0, 0], M = [0, 0, 0], W = [1.2, 0, 0];
      return [node('sphere', [0.28], Y, COLORS.you, 'You'), node('cone', [0.3, 0.55], [0, 0.05, 0], COLORS.bad, 'Attacker'), node('box', [0.45, 0.45, 0.2], W, COLORS.good, 'Website'), link(Y, [-0.2, 0, 0], COLORS.data), link([0.2, 0, 0], W, COLORS.data), node('sphere', [0.07], [-0.7, 0, 0], COLORS.data, 'Your message'), node('torus', [0.45, 0.02], [0, 0.0, 0], COLORS.bad, null, { rotation: [90, 0, 0] })];
    }
  },
  ddos: {
    title: 'How a DDoS attack works', names: ['ddos', 'a ddos attack', 'a ddos', 'denial of service', 'a denial of service attack', 'dos attack', 'a botnet', 'botnet'],
    explain: 'A website can only answer so many visitors at once. In a DDoS attack, the attacker controls thousands of hijacked computers, the small red ones, and makes them all visit the site at the same moment. The site, in the middle, is flooded and real visitors cannot get in. The fix: services that spread out and filter that traffic.',
    build() {
      const S = [0, 0, 0];
      const parts = [node('box', [0.55, 0.7, 0.4], S, COLORS.you, 'Website')];
      const bots = 10;
      for (let i = 0; i < bots; i++) { const a = (i / bots) * Math.PI * 2; const p = [+(Math.cos(a) * 1.25).toFixed(3), +(Math.sin(a) * 1.0).toFixed(3), 0]; parts.push(node('sphere', [0.1], p, COLORS.bad, i === 0 ? 'Bots' : null), link(p, S, '#8a3a36')); }
      parts.push(node('cone', [0.2, 0.36], [0, 1.5, 0], COLORS.bad, 'Attacker'), link([0, 1.32, 0], [0, 1.0, 0], '#8a3a36'), node('sphere', [0.1], [-1.45, -1.3, 0], COLORS.good, 'Locked out'));
      return parts;
    }
  },
  'sql injection': {
    title: 'How SQL injection works', names: ['sql injection', 'an sql injection', 'a sql injection', 'sql injection attack', 'an sql injection attack', 'a sql injection attack', 'injection', 'code injection'],
    explain: 'A website asks for your name, then asks its database a question using it. If the website pastes your words straight into the question, an attacker can type a trick instead of a name, like quote, or one equals one. The database gets a different question and hands over everything. The fix: websites must treat what you type as plain text, using prepared statements.',
    build() {
      const A = [-1.3, 0.5, 0], F = [-0.4, 0.5, 0], D = [1.0, 0, 0];
      return [node('cone', [0.26, 0.45], A, COLORS.bad, 'Attacker'), node('box', [0.55, 0.4, 0.08], F, COLORS.warn, "' OR 1=1 --"), node('cylinder', [0.3, 0.3, 0.55], D, COLORS.good, 'Database'), node('box', [0.4, 0.3, 0.1], [0.3, 0.5, 0], COLORS.neutral, 'Website code'), link(A, F, COLORS.bad), link(F, [0.1, 0.5, 0], COLORS.warn), link([0.5, 0.5, 0], [0.9, 0.25, 0], COLORS.warn), node('sphere', [0.08], [0.9, -0.55, 0], COLORS.data, 'All the data!'), link(D, [0.9, -0.5, 0], COLORS.data)];
    }
  },
  hashing: {
    title: 'How passwords are stored (hashing)', names: ['hashing', 'password hashing', 'how passwords are stored', 'passwords being stored', 'a hash', 'hash'],
    explain: 'A good website never saves your real password. It runs it through a one way scrambler called a hash and saves only the scrambled result. When you log in, it scrambles what you typed and compares. Even if attackers steal the list, they get scrambles, not passwords. That is why long, unusual passwords matter: guessing is the only way in.',
    build() {
      const P = [-1.3, 0, 0], H = [0, 0, 0], R = [1.3, 0, 0];
      return [node('box', [0.55, 0.3, 0.1], P, COLORS.you, 'sunshine1'), node('cylinder', [0.3, 0.3, 0.5], H, COLORS.warn, 'Hash (one way)'), node('box', [0.6, 0.3, 0.1], R, COLORS.good, '8e2f9c0a…'), link([-1.0, 0, 0], [-0.3, 0, 0], COLORS.data), link([0.3, 0, 0], [1.0, 0, 0], COLORS.data), node('cone', [0.16, 0.3], [1.3, -0.8, 0], COLORS.bad, 'Thief gets this')];
    }
  },
  encryption: {
    title: 'How encryption works', names: ['encryption', 'how encryption works', 'encrypting a message', 'a cipher', 'cryptography', 'https'],
    explain: 'Encryption locks a message so only the right person can read it. Your message, the plain words, goes into a lock with a secret key and comes out scrambled. Anyone who grabs it on the way sees nonsense. At the other end, the right key unlocks it again. That is what the padlock in your browser means.',
    build() {
      const A = [-1.4, 0, 0], L = [-0.5, 0, 0], U = [0.5, 0, 0], B = [1.4, 0, 0];
      return [node('sphere', [0.24], A, COLORS.you, 'You: HELLO'), node('box', [0.3, 0.3, 0.3], L, COLORS.warn, 'Lock + key'), node('box', [0.3, 0.3, 0.3], U, COLORS.warn, 'Key unlocks'), node('sphere', [0.24], B, COLORS.good, 'Friend: HELLO'), link([-1.15, 0, 0], [-0.7, 0, 0], COLORS.data), link([-0.3, 0, 0], [0.3, 0, 0], COLORS.bad), link([0.7, 0, 0], [1.15, 0, 0], COLORS.data), node('box', [0.4, 0.14, 0.08], [0, 0.15, 0], COLORS.bad, 'KHOOR')];
    }
  },
  firewall: {
    title: 'How a firewall works', names: ['a firewall', 'firewall', 'firewalls'],
    explain: 'A firewall is a guard at the door of a network. Everything trying to come in from the internet meets the wall. The guard checks each one against rules. Allowed visitors, in green, go through. Everything else, in red, is stopped. It protects the computers behind it.',
    build() {
      const W = [0, 0, 0];
      return [node('box', [0.12, 1.5, 0.5], W, COLORS.warn, 'Firewall'), node('sphere', [0.12], [-1.2, 0.5, 0], COLORS.good, 'Allowed'), node('sphere', [0.12], [-1.2, -0.5, 0], COLORS.bad, 'Blocked'), node('box', [0.45, 0.45, 0.3], [1.2, 0, 0], COLORS.you, 'Your network'), link([-1.1, 0.5, 0], [0.9, 0.1, 0], COLORS.good), link([-1.1, -0.5, 0], [-0.1, -0.2, 0], COLORS.bad), node('cone', [0.1, 0.18], [-0.12, -0.2, 0], COLORS.bad, null, { rotation: [0, 0, 90] })];
    }
  }
};

// Which demo does this mean? Returns a key of DEMOS or null.
function demoKey(topic) {
  const t = clean(topic).replace(/^(?:an? |the )/, '').replace(/ (?:attack|attacks)$/, ' attack');
  for (const [k, d] of Object.entries(DEMOS)) if (d.names.some((n) => clean(n).replace(/^(?:an? |the )/, '') === t) || clean(k) === t) return k;
  return null;
}

function buildDemo(key) {
  const d = DEMOS[key];
  return d ? { title: d.title, parts: d.build(), explain: d.explain, key } : null;
}

// Returns { type: 'workshop-on' | 'workshop-off' | 'workshop-demo' (key) | 'workshop-demos' } or null.
function parseWorkshopCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  if (/^(?:stop|end|turn off|disable|exit|leave|finish|switch off)(?: the)? (?:workshop|teaching|teach|classroom|class) mode$|^(?:workshop|teaching|teach|classroom) mode off$/.test(n)) return { type: 'workshop-off' };
  if (/^(?:start|turn on|enable|begin|enter|switch to|switch on|go into|activate)? ?(?:the )?(?:workshop|teaching|teach|classroom|class) mode(?: on)?$/.test(n)) return { type: 'workshop-on' };
  if (/^(?:what|which|list|show)(?: me)?(?: are)?(?: the| all)?(?: workshop)? (?:demos?|demonstrations?)(?: do you (?:have|know)| can you (?:show|do))?$|^what can you (?:show|demonstrate) (?:me )?(?:about|for) (?:security|cybersecurity|hacking)$/.test(n)) return { type: 'workshop-demos' };
  let m;
  if ((m = n.match(/^(?:show|play|run|give|make|build|draw|animate|demo|demonstrate)(?: me| us)?(?: an?| the)?(?: hologram| demo| demonstration| model| diagram| animation| picture)?(?: of| for| on)?(?: how)? (.+?)(?: works?| happens| happen| is done| are stored)?$/)) || (m = n.match(/^(?:how (?:does|do|is|are)) (.+?)(?: work| works| done| stored)?(?: hologram| demo)?$/)) || (m = n.match(/^(?:demo|demonstrate|explain)(?: with a hologram)? (.+)$/))) {
    const key = demoKey(m[1]);
    if (key && (/hologram|demo|diagram|model|animation|picture|show|draw|play|run|make|build|animate|demonstrate|how/.test(n))) return { type: 'workshop-demo', key };
  }
  return null;
}

const WORKSHOP_STYLE = 'Teaching mode: the listener is a student about 10 to 13 years old in a workshop. Use short sentences, everyday words and one idea at a time. Explain any technical word the first time with a simple real-world comparison. Keep it to two or three sentences, calm and friendly, and when it fits end with one short question that checks they understood. Never give instructions for attacking real people or systems: teach how it works and how to defend against it.';

module.exports = { parseWorkshopCommand, buildDemo, demoKey, DEMOS, WORKSHOP_STYLE };
