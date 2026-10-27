const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, adviceText, extractUrls, checkUrl, splitHost, pwnedCount, strength, sha1, parsePhishCommand } = require('../src/main/phish');

test('known phishing patterns are flagged with reasons a student can follow', () => {
  const lookalike = analyze('From: "PayPal Support" <service@paypa1-secure.top>\nSubject: Your account is suspended\n\nDear customer, we noticed unusual activity. Verify your account within 24 hours: http://paypa1-secure.top/login/verify');
  assert.equal(lookalike.verdict, 'likely phishing');
  assert.match(lookalike.flags.join('\n'), /says it is from paypal, but the sender's address is at paypa1-secure\.top/);
  assert.match(lookalike.flags.join('\n'), /rushes you/);
  assert.match(lookalike.flags.join('\n'), /suspended/);
  const tricked = analyze('Chase: your account has been locked. Confirm your identity at https://chase.com.secure-login.ru/auth now');
  assert.equal(tricked.verdict, 'likely phishing');
  assert.match(tricked.flags.join('\n'), /puts “chase” in the name, but the site is really secure-login\.ru/);
  const ip = analyze('Click here to claim your free iPhone: http://192.168.4.9/win');
  assert.equal(ip.verdict, 'likely phishing');
  assert.match(ip.flags[0], /raw number/);
  assert.match(analyze('Open https://paypal.com@evil.example/login').flags.join('\n'), /@ in it/);
  assert.match(analyze('go to https://xn--pypal-4ve.com/signin').flags.join('\n'), /lookalike characters/);
  assert.match(analyze('please see invoice attached: Invoice_2026.zip and wire transfer the money').flags.join('\n'), /file that can run code|cannot be undone/);
});

test('ordinary mail and real company links are left alone, a link shortener only earns a careful look, and a clean result never claims safety', () => {
  assert.equal(analyze('Hi class, the robotics meeting is moved to Thursday at 3pm. See the schedule at https://docs.google.com/document/d/abc. Thanks, Mr. Lee').verdict, 'nothing obvious');
  assert.equal(analyze('Your Amazon order has shipped. Track it at https://www.amazon.com/progress-tracker/package/123').verdict, 'nothing obvious');
  assert.equal(analyze('Sign in at https://accounts.google.com/signin to continue').verdict, 'nothing obvious', 'a login page on the real site is fine');
  const short = analyze('check this out https://bit.ly/3xYz9 asap');
  assert.equal(short.verdict, 'worth a careful look');
  assert.match(adviceText(short), /link shortener/);
  assert.match(adviceText(analyze('hello there')), /does not prove it is safe/);
  assert.match(adviceText(analyze('Click here to claim your free iPhone: http://192.168.4.9/win')), /^This looks like phishing\. .*Do not click the links/);
  assert.deepEqual(analyze('mail me at sam@school.org').urls, [], 'an email address is not a link');
});

test('addresses are split into the part that counts, and links are found with or without http', () => {
  assert.deepEqual([splitHost('mail.paypal.com.evil.ru').registrable, splitHost('mail.paypal.com.evil.ru').subdomain], ['evil.ru', 'mail.paypal.com']);
  assert.equal(splitHost('www.bbc.co.uk').registrable, 'bbc.co.uk');
  assert.deepEqual(extractUrls('see https://a.example/x, and www.b.example/y. also c-d.example.com/z!'), ['https://a.example/x', 'www.b.example/y', 'c-d.example.com/z']);
  assert.equal(checkUrl('https://github.com/serjdmitri/Relay').length, 0);
  assert.ok(checkUrl('https://githuh.com/login').some((f) => /looks like “github”/.test(f.text)));
});

test('the breach check sends only 5 characters of the hash, compares the rest here, and says how often it was found', async () => {
  assert.equal(sha1('password'), '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  const seen = [];
  const fetchFn = async (url, init) => { seen.push([url, init.headers['Add-Padding']]); return { ok: true, text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\n' }; };
  assert.equal(await pwnedCount('password', { fetchFn }), 9545824);
  assert.deepEqual(seen[0], ['https://api.pwnedpasswords.com/range/5BAA6', 'true']);
  assert.ok(!seen[0][0].includes('E4C9B93'), 'the rest of the hash never leaves');
  assert.equal(await pwnedCount('a-very-unlikely-password-9X!', { fetchFn }), 0);
  assert.equal(await pwnedCount('x', { fetchFn: async () => ({ ok: false, status: 503 }) }), -1);
});

test('strength is rough but honest: short or patterned is weak, long and mixed is strong', () => {
  assert.equal(strength('hunter2').label, 'weak');
  assert.equal(strength('password1').label, 'weak');
  assert.equal(strength('qwerty123456').label, 'weak');
  assert.equal(strength('correct horse battery staple').label, 'strong');
  assert.equal(strength('kX9#mP2$vL8@qq').label, 'strong');
});

test('the phrases', () => {
  for (const t of ['is this email phishing', 'is this a phishing email', 'is this a scam', 'is this link safe', 'is this legit', 'check this link', 'check this email for phishing', 'should I click this', 'can I trust this email', 'does this message look suspicious']) assert.deepEqual(parsePhishCommand(t), { type: 'phish' }, t);
  for (const t of ['has my password been breached', 'check my password', 'is my password safe', 'has this password been leaked', 'is my password in a data breach']) assert.deepEqual(parsePhishCommand(t), { type: 'breach' }, t);
  for (const t of ['open notes', 'is this a good idea', 'check the weather', 'what is phishing', 'is it raining']) assert.equal(parsePhishCommand(t), null, t);
});
