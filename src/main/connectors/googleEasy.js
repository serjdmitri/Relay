// Making Google easier to connect. Two ways, neither needs you to upload anything by hand:
//  1. Calendar (and Reminders) come through macOS: add your Google account in System Settings > Internet Accounts and Relay reads and edits those
//     calendars through the Mac itself. No developer setup. This file recognises a Google account among the Mac's calendars.
//  2. Gmail, Drive, Docs and Sheets need Google's own sign-in, which needs a one-time "app" of your own in Google Cloud. The guided setup opens each
//     page in order, and when the credentials file lands in Downloads Relay picks it up by itself and starts the sign-in (no file picker, no copy and paste).
// Pure helpers, so they are tested without Google or a Mac.

const isGoogleSource = (c) => /\b(google|gmail)\b|@gmail\.com|@googlemail\.com/i.test(`${c?.account || ''} ${c?.name || ''}`);
const googleCalendars = (list) => (Array.isArray(list) ? list.filter(isGoogleSource) : []);

// The pages, in order. The first one enables all five APIs at once (Google's enable-APIs link takes a list).
const STEPS = [
  { title: 'Create a Google Cloud project', url: 'https://console.cloud.google.com/projectcreate', text: 'Name it anything (for example "Relay") and click Create. It is free; no card is needed.' },
  { title: 'Turn on the APIs', url: 'https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com,docs.googleapis.com,sheets.googleapis.com', text: 'Click Enable. This switches on Gmail, Calendar, Drive, Docs and Sheets for your project.' },
  { title: 'Set up the consent screen', url: 'https://console.cloud.google.com/apis/credentials/consent', text: 'Choose External, fill in the app name and your email, add yourself as a test user, then click Publish app so the sign-in does not expire after 7 days.' },
  { title: 'Create the Desktop app credentials', url: 'https://console.cloud.google.com/apis/credentials', text: 'Create credentials > OAuth client ID > Desktop app, then click Download JSON. Relay notices the file in Downloads and finishes the rest.' }
];

// A credentials file Google just made: client_secret_<id>.json (also "client_secret (1).json"), changed in the last few minutes, small.
function findCredentialFile(entries, now = Date.now(), withinMs = 15 * 60000) {
  const hits = (entries || []).filter((e) => e && /^client_secret.*\.json$/i.test(e.name) && e.size > 0 && e.size <= 65536 && now - e.mtimeMs <= withinMs && now - e.mtimeMs >= -60000);
  return hits.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
}

// "connect Google", "set up Google calendar", "link my gmail" ...
function parseGoogleSetup(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:jarvis|relay)[, ]+/i, '').replace(/^please[, ]+/i, '').replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  return /^(?:connect|link|set up|setup|add|sign in to|log in to) (?:my |the )?(?:google|gmail|google calendar|google account|google drive|google docs)(?: account)?(?: to (?:relay|jarvis))?$/.test(n) ? { type: 'google-setup' } : null;
}

module.exports = { isGoogleSource, googleCalendars, STEPS, findCredentialFile, parseGoogleSetup };
