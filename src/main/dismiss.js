// An answer stays on screen until you dismiss it: Esc, saying "ok" (or "thanks", "got it", "close"...), or asking something else. Short replies to quick commands
// ("Paused.", "Volume 40%.") are not answers worth holding and go by themselves, as do replies nobody is there to read.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');

// Only meaningful while an answer is being held.
const DISMISS = /^(?:ok|okay|k|kay|alright|all right|thanks|thank you|thanks a lot|thank you very much|got it|i got it|understood|cool|great|perfect|nice|close|close it|close that|dismiss|dismiss it|clear|clear it|clear that|hide|hide it|done|i m done|that s all|that is all|that will be all|never mind|nevermind|go away|ok thanks|okay thanks|ok thank you|okay thank you|ok got it|okay got it|ok jarvis|okay jarvis)$/;

const parseDismiss = (text) => DISMISS.test(clean(text).replace(/'/g, ' ').replace(/\s+/g, ' ').trim());

// Hold it when it was worked out by the model, or is a real sentence or more; not for replies sent to the phone or run on a schedule.
function shouldHoldAnswer({ reply = '', status = 'done', model = '', remote = false, unattended = false, busy = false, setting = true } = {}) {
  if (!setting || remote || unattended || busy || status === 'stopped') return false; // busy: a quiz or checklist is running, where "ok" and "got it" mean something else
  const r = String(reply).trim();
  if (!r) return false;
  return !!model || r.length >= 50;
}

module.exports = { parseDismiss, shouldHoldAnswer, DISMISS_MAX_MS: 10 * 60 * 1000 };
