// Is the Mac online? Two rounds of probes, ten seconds apart, must both fail before Relay calls itself offline, and two must succeed to come back, so a
// dropped packet or a hotel login page does not flip it back and forth. The probes are injected.

class Connectivity {
  // probe() -> true when any one of the checks got an answer; onChange(online)
  constructor({ probe, onChange = () => {}, setTimer = setTimeout, gapMs = 10000 }) {
    Object.assign(this, { probe, onChange, setTimer, gapMs });
    this.online = true;
    this.streak = 0; // consecutive rounds that disagree with the current state
  }

  async check() {
    const up = await this.probe().catch(() => false);
    if (up === this.online) { this.streak = 0; return this.online; }
    this.streak++;
    if (this.streak >= 2) { this.online = up; this.streak = 0; this.onChange(this.online); return this.online; }
    // one round disagreed: look again soon to be sure
    await new Promise((r) => this.setTimer(r, this.gapMs));
    return this.check();
  }
}

// The things that work with no model and no internet are handled before this point; what is left needs either a model that can drive the Mac
// (which a small local model cannot do safely) or the internet. So offline, only plain conversation goes to the local model.
const NEEDS_TOOLS = /\b(?:open|launch|quit|close|send|text|email|message|call|create|make|add|write|delete|remove|trash|move|rename|click|type|press|search|look up|google|browse|download|install|run|schedule|remind|set up|turn (?:on|off)|play|pause|screenshot|read my|check my|find (?:my|the|a) (?:file|folder|email))\b/i;

const needsInternet = (text) => NEEDS_TOOLS.test(String(text || ''));

const OFFLINE_SYSTEM = 'You are Relay, a voice assistant, answering with no internet and no tools. Answer briefly in plain speech. If the user wants something done on the Mac or on the web, say you need the internet for that. Never claim to have done anything.';

module.exports = { Connectivity, needsInternet, OFFLINE_SYSTEM };
