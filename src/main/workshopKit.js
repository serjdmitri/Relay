// The STEMINA kit: for each workshop demo, a short quiz (made here, so it works offline and the answers are known to be right), the words to know, how to stay
// safe, and a one-page printable handout. Pure; turning the handout into a PDF is the controller's job.

// quiz answers are one key word on purpose: the quiz marks an answer right when its words are said.
const KIT = {
  phishing: {
    vocab: [['Phishing', 'A trick that uses a fake message to steal your information.'], ['Spoofing', 'Making a message look like it came from someone you trust.'], ['Two-step login', 'A second proof it is you, like a code sent to your phone.']],
    defend: ['Look at the sender address and the link before you click. Rest the pointer on a link to see where it really goes.', 'A real company will never ask for your password in an email.', 'Be careful when a message says hurry or threatens you. That is a trick to stop you thinking.', 'Not sure? Go to the website yourself by typing the address, and ask a trusted adult.'],
    quiz: [['In a phishing attack, the attacker sends you a fake what?', 'email'], ['What should you check before you click a link in a message? Hint: where it goes.', 'address'], ['Real companies never ask for your what by email?', 'password'], ['Safest way to check a message from your bank: click its link, or go to the website by typing it in yourself?', 'yourself']],
    activity: 'Look at three emails or texts (a teacher can bring printed examples). For each one, circle what makes it look real and what gives it away.'
  },
  'man in the middle': {
    vocab: [['Man in the middle', 'An attacker who secretly sits between you and a website and can read what passes by.'], ['Open Wi-Fi', 'A network with no password, so anyone can join and listen.'], ['HTTPS', 'The padlock in your browser. It means the connection is encrypted.']],
    defend: ['Look for the padlock and https before typing anything private.', 'Avoid logging in to important accounts on open Wi-Fi.', 'A VPN scrambles your traffic so others on the network cannot read it.', 'If your browser warns that a site is not safe, believe it and go back.'],
    quiz: [['In a man-in-the-middle attack, where does the attacker sit?', 'middle'], ['Which Wi-Fi makes this attack easier: open, or password protected?', 'open'], ['The padlock and https mean your message is what? Hint: encr...', 'encrypted'], ['Which tool hides your traffic on public Wi-Fi? Hint: it starts with V.', 'VPN']],
    activity: 'Pass a note across the room through two classmates in the middle. Talk about how you could tell if someone read it, or changed it.'
  },
  ddos: {
    vocab: [['DDoS', 'Distributed denial of service: thousands of computers visit one site at once so real visitors cannot get in.'], ['Botnet', 'A network of hijacked computers that an attacker controls.'], ['Traffic', 'The visits and messages going to a website.']],
    defend: ['Websites use services that spot and filter fake visitors.', 'Keep your own devices updated so they do not get hijacked into a botnet.', 'Use strong, different passwords on devices and routers.', 'Never join or run an attack, even as a joke. It is a crime.'],
    quiz: [['What does the first D in DDoS stand for?', 'distributed'], ['A network of hijacked computers is called a what? Hint: it starts with bot.', 'botnet'], ['When too many visits arrive at once, does the website slow down or speed up?', 'slow'], ['Does a DDoS attack come from thousands of computers, or just one?', 'thousands']],
    activity: 'Everyone walks to the door at the same moment. Talk about what happens, then about how a guard or a line would help.'
  },
  'sql injection': {
    vocab: [['Database', 'Where a website stores information, like accounts.'], ['SQL', 'The language used to ask a database questions.'], ['Injection', 'Typing a trick into a form so it changes the question.']],
    defend: ['A safe website treats what you type as plain data, never as part of the question.', 'Websites check and clean what you type before using it.', 'Developers use prepared statements, which keep the question and your answer apart.', 'Only test for weaknesses on practice sites made for it, never on a real site.'],
    quiz: [['What does SQL ask questions of?', 'database'], ['A safe website treats what you type as data, not as what?', 'code'], ['What should a website do to what you type before using it? Hint: validate.', 'validate'], ['Name the attack where a trick typed into a form changes a database question.', 'injection']],
    activity: 'Write a question for a "friend database" on paper, then see what happens when a name contains a sneaky extra instruction.'
  },
  hashing: {
    vocab: [['Hash', 'A one-way scrambler. The same input always gives the same scramble, but you cannot unscramble it.'], ['Salt', 'Random extra characters added to a password before hashing, so two equal passwords do not look alike.'], ['Password manager', 'A program that remembers long, different passwords for you.']],
    defend: ['Use a long password or a few random words. Long beats short with symbols.', 'Use a different password for every account.', 'Use a password manager, and turn on two-step login.', 'A website that can email you your real password is storing it badly.'],
    quiz: [['Does a good website save your real password, or a scrambled version?', 'scrambled'], ['What is the one-way scrambler called?', 'hash'], ['What makes a password hard to guess: short and common, or long and unusual?', 'long'], ['Random extra characters added before hashing are called what? Hint: like on food.', 'salt']],
    activity: 'Each student scrambles a word with a secret rule (like shift every letter by one). Swap and see why a one-way scrambler is stronger.'
  },
  encryption: {
    vocab: [['Encryption', 'Scrambling a message so only someone with the key can read it.'], ['Key', 'The secret that locks and unlocks the message.'], ['Ciphertext', 'The scrambled message.']],
    defend: ['Use apps and websites that encrypt (the padlock, or end-to-end encryption in messages).', 'Keep your keys and passwords secret.', 'Keep your devices updated, since updates fix weak spots.', 'Remember that encryption protects the message in transit, not you from a fake website.'],
    quiz: [['What do you need to lock and unlock an encrypted message?', 'key'], ['The scrambled message is called what? Hint: cipher...', 'ciphertext'], ['What shows in your browser when a site uses encryption?', 'padlock'], ['If an attacker grabs an encrypted message, do they see the real words or scrambled letters?', 'scrambled']],
    activity: 'Make a Caesar cipher wheel from two paper circles. Send a short secret message to a partner and have them decode it with the key.'
  },
  firewall: {
    vocab: [['Firewall', 'A guard that checks traffic against rules and blocks what does not belong.'], ['Rule', 'An instruction like "allow web pages, block everything else".'], ['Network', 'A group of connected computers.']],
    defend: ['Keep the firewall on, on your computer and your home router.', 'A firewall is one layer. You still need updates and good passwords.', 'Only allow what you need.', 'If something asks you to turn the firewall off, ask a trusted adult first.'],
    quiz: [['What does a firewall check each visitor against?', 'rules'], ['What happens to visitors the rules do not allow?', 'blocked'], ['Does a firewall stand at the door of a network, or inside every computer room?', 'door'], ['What does a firewall protect?', 'network']],
    activity: 'One student is the guard with a list of rules (for example, only people in blue shirts may enter). Others try to get in. Change a rule and see what changes.'
  }
};

const SAFETY = 'Practise only on your own devices or on sites made for practice. Never try these on real people or systems.';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const quizCards = (key) => (KIT[key] ? KIT[key].quiz.map(([question, answer]) => ({ question, answer })) : null);

// One letter-size page: what happens, words to know, how to stay safe, a quiz with lines to write on, and an activity.
function handoutHtml(key, { title, explain, org = 'STEMINA', date = '' } = {}) {
  const k = KIT[key];
  if (!k) return null;
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: letter; margin: 0.5in; }
* { box-sizing: border-box; }
body { font: 11pt/1.35 -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
header { border-bottom: 3px solid #1b6fd8; padding-bottom: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: baseline; }
h1 { font-size: 20pt; margin: 0; } .org { font-size: 9pt; color: #555; }
h2 { font-size: 12pt; margin: 10px 0 3px; color: #1b6fd8; }
p, ul, ol { margin: 0; } ul, ol { padding-left: 18px; }
dl { margin: 0; display: grid; grid-template-columns: 110px 1fr; gap: 2px 8px; } dt { font-weight: 700; } dd { margin: 0; }
.line { border-bottom: 1px solid #888; height: 20px; margin: 2px 0 0 16px; }
.name { font-size: 10pt; margin-bottom: 4px; }
.safe { margin-top: 10px; padding: 6px 8px; border: 1.5px solid #c0392b; font-size: 9.5pt; }
</style></head><body>
<header><h1>${esc(title)}</h1><div class="org">${esc(org)}${date ? ` · ${esc(date)}` : ''}</div></header>
<div class="name">Name: ______________________________</div>
<h2>What happens</h2><p>${esc(explain)}</p>
<h2>Words to know</h2><dl>${k.vocab.map(([w, d]) => `<dt>${esc(w)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
<h2>How to stay safe</h2><ul>${li(k.defend)}</ul>
<h2>Check yourself</h2><ol>${k.quiz.map(([q]) => `<li>${esc(q)}<div class="line"></div></li>`).join('')}</ol>
<h2>Try it</h2><p>${esc(k.activity)}</p>
<div class="safe"><b>Remember:</b> ${esc(SAFETY)}</div>
</body></html>`;
}

module.exports = { KIT, quizCards, handoutHtml, SAFETY };
