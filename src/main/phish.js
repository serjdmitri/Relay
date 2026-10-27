// Is this email or link a phishing attempt? A set of plain, explainable checks (no model, nothing sent anywhere): what is wrong with each link's address, what the
// message pushes you to do, and whether the sender matches who it claims to be. It can say "this has several red flags", never "this is safe": a clean result
// only means nothing obvious was found. Also the Have I Been Pwned password check, which sends only the first 5 characters of the password's SHA-1 hash.

const crypto = require('crypto');

const BRANDS = ['paypal', 'apple', 'icloud', 'amazon', 'microsoft', 'outlook', 'office365', 'google', 'gmail', 'facebook', 'instagram', 'whatsapp', 'netflix', 'spotify', 'chase', 'wellsfargo', 'bankofamerica', 'citibank', 'capitalone', 'usps', 'fedex', 'ups', 'dhl', 'irs', 'dropbox', 'docusign', 'linkedin', 'github', 'discord', 'steam', 'roblox', 'coinbase', 'binance', 'venmo', 'cashapp', 'zelle', 'adobe', 'twitter', 'tiktok', 'snapchat', 'telegram', 'zoom', 'schoology', 'canvas', 'blackboard', 'collegeboard'];
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'bit.do', 'lnkd.in']);
const BAD_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'support', 'work', 'gq', 'tk', 'ml', 'cf', 'ga', 'loan', 'country', 'kim', 'men', 'review', 'rest', 'monster', 'icu', 'cyou', 'buzz']);
const TWO_PART = new Set(['co.uk', 'com.au', 'co.jp', 'co.in', 'com.br', 'co.nz', 'org.uk', 'ac.uk', 'gov.uk', 'com.mx', 'co.za']);
const LOGIN_WORDS = /\b(?:login|log-in|signin|sign-in|verify|verification|secure|security|update|account|password|confirm|billing|wallet|unlock|restore|suspend|support|helpdesk)\b/i;

const deLeet = (s) => s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/\$/g, 's').replace(/rn/g, 'm').replace(/vv/g, 'w');
function editDistance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

// "mail.paypal.com.evil.ru" -> { host, labels, registrable: 'evil.ru', tld: 'ru', subdomain: 'mail.paypal.com' }
function splitHost(host) {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const two = labels.slice(-2).join('.');
  const n = TWO_PART.has(two) ? 3 : 2;
  return { host: labels.join('.'), labels, registrable: labels.slice(-n).join('.'), tld: labels.at(-1), subdomain: labels.slice(0, -n).join('.'), name: labels.at(-n) || labels[0] };
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|info|biz|ru|cn|top|xyz|click|support|work|zip|app|dev|me|us|uk|de|fr|tk|ml|ga|cf|gq)\b(?:\/[^\s<>"')\]]*)?/gi;
function extractUrls(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    if (/^[\w.+-]+@/.test(raw) || seen.has(raw)) continue;
    // an email address's domain is not a link
    if (text[m.index - 1] === '@') continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.slice(0, 12);
}

// Checks of one link. Returns [{ weight, text }].
function checkUrl(raw) {
  const flags = [];
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`); } catch { return [{ weight: 1, text: `“${raw.slice(0, 50)}” is not a normal web address` }]; }
  const authorityAt = /^[a-z]+:\/\/[^/]*@/i.test(raw);
  const h = splitHost(u.hostname);
  const shown = u.hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) || /^\[/.test(u.hostname)) flags.push({ weight: 4, text: `${shown} is a raw number, not a name: real companies use their name` });
  if (authorityAt) flags.push({ weight: 4, text: 'the address has an @ in it, which hides where the link really goes' });
  if (/(^|\.)xn--/.test(u.hostname) || /[^\x00-\x7f]/.test(raw.split('/')[2] || '')) flags.push({ weight: 4, text: `${shown} uses lookalike characters from other alphabets` });
  if (SHORTENERS.has(h.registrable)) flags.push({ weight: 2, text: `${h.registrable} is a link shortener: you cannot see where it leads` });
  if (BAD_TLDS.has(h.tld)) flags.push({ weight: 2, text: `.${h.tld} is an ending that is often used for scams` });
  if (h.labels.length >= 5) flags.push({ weight: 2, text: `${shown} has a long chain of parts: only the last two matter` });
  // a brand's name somewhere it does not belong
  for (const b of BRANDS) {
    const real = new RegExp(`^${b}\\.[a-z.]+$`).test(h.registrable) || h.name === b;
    if (!real && (h.subdomain.split('.').includes(b) || h.name.includes(b) && h.name !== b)) { flags.push({ weight: 5, text: `${shown} puts “${b}” in the name, but the site is really ${h.registrable}` }); break; }
    if (h.name !== b && h.name.length >= 5 && (editDistance(deLeet(h.name), b) <= 1 && h.name !== b) ) { flags.push({ weight: 5, text: `${h.registrable} looks like “${b}” with a letter changed` }); break; }
  }
  if (!/^https:/i.test(u.protocol) && /^http:/i.test(raw)) flags.push({ weight: 1, text: 'the link is not encrypted (http, not https)' });
  if ((LOGIN_WORDS.test(u.hostname) || LOGIN_WORDS.test(u.pathname)) && !BRANDS.some((b) => h.name === b)) flags.push({ weight: 2, text: `a ${LOGIN_WORDS.exec(u.hostname + u.pathname)[0]} page on ${h.registrable}, a site you may not know` });
  if (u.hostname.split('-').length > 3) flags.push({ weight: 1, text: `${shown} is full of dashes` });
  return flags;
}

const TEXT_RULES = [
  [3, /\b(?:within|in the next|in) (?:24|48|12|\d{1,2}) ?(?:hours?|hrs)\b|\b(?:immediately|urgent(?:ly)?|act now|final notice|last warning|right away|as soon as possible|expires? (?:today|soon|in))\b/i, 'it rushes you ("act now", "within 24 hours")'],
  [3, /\b(?:account|access|card|profile|payment)\b.{0,40}\b(?:suspended|locked|disabled|limited|restricted|closed|deactivated|compromised|on hold)\b|\bunusual (?:activity|sign[- ]?in|login)\b|\bsuspicious (?:activity|login|sign[- ]?in)\b/i, 'it scares you with a locked or suspended account'],
  [3, /\b(?:verify|confirm|validate|update|re-?enter) (?:your )?(?:account|identity|password|payment|billing|information|details|login|credentials|card)\b/i, 'it asks you to verify or update something'],
  [3, /\b(?:password|passcode|pin number|social security|ssn|card number|cvv|security code|bank account|routing number|login credentials)\b/i, 'it asks for, or talks about, secret details'],
  [3, /\bgift ?cards?\b|\bwire (?:transfer|the money)\b|\bbitcoin\b|\bcrypto(?:currency)?\b|\bwestern union\b|\bzelle\b/i, 'it wants money in a way that cannot be undone (gift cards, wire, crypto)'],
  [2, /\b(?:click|tap) (?:the )?(?:link|button|here|below)\b|\bfollow (?:this|the) link\b/i, 'it tells you to click a link'],
  [2, /\bdear (?:customer|user|client|member|valued|account holder|sir|madam|friend)\b|\bhello (?:customer|user|dear)\b/i, 'it does not use your name'],
  [3, /\b(?:you(?:'ve| have) won|winner|prize|lottery|inheritance|free (?:iphone|gift|money)|claim your)\b/i, 'it says you won something'],
  [3, /\battach(?:ed|ment)\b.{0,60}\.(?:zip|exe|scr|html?|docm|xlsm|iso|js|jar|lnk)\b|\.(?:exe|scr|docm|xlsm|iso|lnk)\b/i, 'it comes with a file that can run code'],
  [2, /\b(?:invoice|payment|order|package|delivery|shipment) (?:#?\w+ )?(?:is )?(?:attached|overdue|pending|failed|could not be delivered|on hold)\b/i, 'it is about an invoice or parcel you may not expect'],
  [2, /\b(?:do not|don't) (?:tell|share|discuss)|keep this (?:confidential|secret|between us)\b/i, 'it asks you to keep it secret'],
  [2, /\b(?:ceo|president|principal|boss|director)\b.{0,50}\b(?:urgent|favor|task|purchase|gift ?cards?)\b/i, 'it pretends to be someone senior asking for a favour']
];

// Header lines, when the whole email was copied: who it says it is from, and what the mail system found.
function checkHeaders(text) {
  const flags = [];
  const from = text.match(/^From:\s*(?:"?([^"<\n]*?)"?\s*)?<?([\w.+-]+@([\w.-]+))>?\s*$/im);
  if (from) {
    const display = (from[1] || '').toLowerCase();
    const dom = splitHost(from[3]);
    for (const b of BRANDS) if (display.includes(b) && dom.name !== b && !dom.subdomain.split('.').includes(b)) { flags.push({ weight: 5, text: `it says it is from ${b}, but the sender's address is at ${dom.registrable}` }); break; }
    if (BAD_TLDS.has(dom.tld)) flags.push({ weight: 2, text: `the sender's address ends in .${dom.tld}, often used for scams` });
    const reply = text.match(/^Reply-To:\s*.*?[\w.+-]+@([\w.-]+)/im);
    if (reply && splitHost(reply[1]).registrable !== dom.registrable) flags.push({ weight: 3, text: `replies would go to ${splitHost(reply[1]).registrable}, not to the sender` });
  }
  if (/\b(?:spf|dkim|dmarc)=(?:fail|softfail|none)\b/i.test(text)) flags.push({ weight: 4, text: 'the mail system could not confirm the sender (a failed SPF, DKIM or DMARC check)' });
  return flags;
}

// Returns { verdict: 'likely phishing' | 'suspicious' | 'worth a careful look' | 'nothing obvious', score, flags: [text], urls }.
function analyze(text) {
  const t = String(text || '');
  const urls = extractUrls(t);
  const found = [];
  for (const u of urls) for (const f of checkUrl(u)) found.push(f);
  for (const [weight, re, label] of TEXT_RULES) if (re.test(t)) found.push({ weight, text: label });
  found.push(...checkHeaders(t));
  const seen = new Set();
  const flags = found.filter((f) => (seen.has(f.text) ? false : seen.add(f.text))).sort((a, b) => b.weight - a.weight);
  const score = flags.reduce((s, f) => s + f.weight, 0);
  const verdict = score >= 8 || flags.some((f) => f.weight >= 5) && score >= 6 ? 'likely phishing' : score >= 4 ? 'suspicious' : score >= 1 ? 'worth a careful look' : 'nothing obvious';
  return { verdict, score, flags: flags.map((f) => f.text), urls };
}

// What to say: the verdict, the strongest reasons, and what to do.
function adviceText(r) {
  if (r.verdict === 'worth a careful look') return `Nothing alarming, but ${r.flags[0]}. Be careful before you click, and if it matters go to the site yourself by typing its address.`;
  if (r.verdict === 'nothing obvious') return `I found no obvious red flags${r.urls.length ? ` in ${r.urls.length === 1 ? 'the link' : 'the links'}` : ''}. That does not prove it is safe: if it asks for a password or money, go to the site yourself by typing its address, or ask the person another way.`;
  const top = r.flags.slice(0, 3);
  return `${r.verdict === 'likely phishing' ? 'This looks like phishing.' : 'This is suspicious.'} ${top.map((f) => f[0].toUpperCase() + f.slice(1)).join('. ')}. Do not click the links or open attachments. If it claims to be from a company, go to their site by typing the address yourself. You can report it as phishing to your email provider.`;
}

// ---- passwords ----
const sha1 = (s) => crypto.createHash('sha1').update(String(s), 'utf8').digest('hex').toUpperCase();

// How many times this password appears in known breaches (Have I Been Pwned), or -1 if the service could not be reached. Only the first 5 characters of the
// hash leave the Mac; the rest is compared here. The range answer is padded by the service so its size gives nothing away.
async function pwnedCount(password, { fetchFn = fetch, signal } = {}) {
  const h = sha1(password);
  const res = await fetchFn(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'Relay-password-check' }, signal });
  if (!res.ok) return -1;
  const suffix = h.slice(5);
  for (const line of (await res.text()).split(/\r?\n/)) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

// A rough strength check that needs no network (not a promise of security).
function strength(password) {
  const p = String(password);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const pool = [/[a-z]/.test(p) ? 26 : 0, /[A-Z]/.test(p) ? 26 : 0, /\d/.test(p) ? 10 : 0, /[^A-Za-z0-9]/.test(p) ? 33 : 0].reduce((a, b) => a + b, 0) || 1;
  let bits = Math.log2(pool) * p.length;
  const common = /^(?:password|123456|qwerty|letmein|welcome|admin|iloveyou|dragon|monkey|football|abc123|111111|passw0rd)/i.test(p) || /^(.)\1+$/.test(p) || /(?:0123|1234|2345|abcd|qwer)/i.test(p);
  if (common) bits = Math.min(bits, 20);
  if (/^[A-Za-z]+\d{1,4}$/.test(p)) bits = Math.min(bits, 26); // a word and a few digits
  return { bits: Math.round(bits), label: bits < 28 ? 'weak' : bits < 45 ? 'fair' : bits < 65 ? 'good' : 'strong', length: p.length, classes };
}

// Returns { type: 'phish' } | { type: 'breach' } | null.
function parsePhishCommand(text) {
  const n = String(text || '').toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  if (/^(?:is|does|do) (?:this|that|the) (?:email|e-mail|message|text|link|url|website|site|page|attachment|dm|sms)(?: here)? (?:a |an )?(?:phishing|phish|scam|fake|legit|legitimate|real|safe|suspicious|fishy|spam|malicious|dangerous|trustworthy|look(?:s)? (?:like )?(?:phishing|a scam|fake|suspicious|fishy|legit))(?: (?:email|message|attempt|scam|link))?(?: to click| to open)?$/.test(n)) return { type: 'phish' };
  if (/^(?:is|does) (?:this|that) (?:an? )?(?:phishing|scam|fake|spam|suspicious|fishy|malicious)(?: email| e-mail| message| link| text| attempt| site| website)?$/.test(n)) return { type: 'phish' };
  if (/^(?:is|are) (?:this|that|these|those)(?: [a-z]+)? (?:safe|legit|legitimate|real|fake|a scam|phishing|suspicious)(?: to (?:click|open|trust))?$/.test(n)) return { type: 'phish' };
  if (/^(?:check|scan|analy[sz]e|inspect|look at|look over|test|vet) (?:this|that|the)(?: selected| copied)?(?: email| e-mail| message| link| url| text| website| attachment)?(?: for (?:phishing|scams?|red flags|danger|safety))?$/.test(n) && /(?:email|e-mail|message|link|url|text|website|phishing|scam|red flags|attachment)/.test(n)) return { type: 'phish' };
  if (/^(?:can i trust|should i trust|should i click|should i open) (?:this|that)(?: email| link| message| attachment)?$/.test(n)) return { type: 'phish' };
  if (/^(?:has|have|was|is|did) (?:my|this|that|the)(?: copied| selected)? password(?: i copied)?(?: been| ever been| got)?(?: breached| leaked| pwned| hacked| exposed| compromised| in a (?:data )?breach)?$|^(?:check|test|is) (?:my|this|that|the)(?: copied| selected)? password(?: safe| strong| secure| breached| leaked| pwned)?(?: against breaches)?$|^(?:has|have) (?:my|this) password (?:been )?(?:in (?:a )?)?(?:data )?(?:breach|breaches)$|^is (?:my|this) password (?:in a (?:data )?breach|safe to use)$|^(?:pwned|breach) (?:check|test)(?: my password)?$/.test(n)) return { type: 'breach' };
  return null;
}

module.exports = { analyze, adviceText, extractUrls, checkUrl, splitHost, pwnedCount, strength, sha1, parsePhishCommand, BRANDS };
