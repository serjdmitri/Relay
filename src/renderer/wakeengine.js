// A small, always-on "Hey Jarvis" detector, and a voice-activity detector, both running on this Mac through the ONNX runtime Relay already carries for face recognition.
// This replaces running full speech recognition all day just to hear one phrase: it costs a fraction of the battery, answers faster, and has no 90-second restarts.
//
// WakeEngine is the openWakeWord pipeline (free, Apache-2.0 code; its pre-made "hey jarvis" model is CC BY-NC-SA 4.0: for personal use, not for selling):
//   16 kHz audio in blocks of 1280 samples (80 ms) -> a spectrogram model -> a speech-embedding model -> the "hey jarvis" classifier on the last 16 embeddings -> a score from 0 to 1.
// Vad is Silero VAD (free, MIT): is someone speaking in this block? Used to tell a voice from a fan or a TV, and to notice when you have stopped talking.
// Plain classes with the runtime and the model bytes passed in, so they run in the page and in the tests.

const FRAME = 1280;       // samples per block (80 ms at 16 kHz)
const MEL_WINDOW = 1760;  // the spectrogram model looks at the latest block plus 480 samples before it
const MEL_ROWS_KEEP = 970;
const EMBED_WINDOW = 76;  // spectrogram rows per embedding
const CLF_WINDOW = 16;    // embeddings per classification

export class WakeEngine {
  // ort: the ONNX runtime; mel, emb, clf: loaded InferenceSessions (melspectrogram, embedding_model, hey_jarvis)
  constructor({ ort, mel, emb, clf }) { Object.assign(this, { ort, mel, emb, clf }); this.reset(); }

  reset() {
    this.raw = new Float32Array(0);
    this.melRows = [];
    this.embeds = [];
    this.seen = 0;
  }

  // frame: Float32Array of FRAME samples on the 16-bit scale (-32768..32767). Returns the score for "hey jarvis" after this block, or 0 while it is still warming up.
  async push(frame) {
    if (!frame || frame.length !== FRAME) throw new Error(`a block is ${FRAME} samples`);
    const joined = new Float32Array(Math.min(MEL_WINDOW, this.raw.length + FRAME));
    const keep = joined.length - FRAME;
    if (keep > 0) joined.set(this.raw.subarray(this.raw.length - keep), 0);
    joined.set(frame, keep);
    this.raw = joined;
    if (joined.length < MEL_WINDOW) return 0; // the first few blocks only fill the buffer
    const { Tensor } = this.ort;
    const m = (await this.mel.run({ [this.mel.inputNames[0]]: new Tensor('float32', joined, [1, joined.length]) }))[this.mel.outputNames[0]];
    const rows = m.dims[2], cols = m.dims[3];
    for (let r = 0; r < rows; r++) { const row = new Float32Array(cols); for (let c = 0; c < cols; c++) row[c] = m.data[r * cols + c] / 10 + 2; this.melRows.push(row); }
    if (this.melRows.length > MEL_ROWS_KEEP) this.melRows.splice(0, this.melRows.length - MEL_ROWS_KEEP);
    if (this.melRows.length < EMBED_WINDOW) return 0;
    const win = new Float32Array(EMBED_WINDOW * 32);
    this.melRows.slice(-EMBED_WINDOW).forEach((row, i) => win.set(row, i * 32));
    const e = (await this.emb.run({ [this.emb.inputNames[0]]: new Tensor('float32', win, [1, EMBED_WINDOW, 32, 1]) }))[this.emb.outputNames[0]];
    this.embeds.push(Float32Array.from(e.data));
    if (this.embeds.length > 120) this.embeds.splice(0, this.embeds.length - 120);
    this.seen++;
    if (this.embeds.length < CLF_WINDOW || this.seen < 5) return 0; // the first few embeddings are not trustworthy yet (as in openWakeWord)
    const x = new Float32Array(CLF_WINDOW * 96);
    this.embeds.slice(-CLF_WINDOW).forEach((v, i) => x.set(v, i * 96));
    const s = (await this.clf.run({ [this.clf.inputNames[0]]: new Tensor('float32', x, [1, CLF_WINDOW, 96]) }))[this.clf.outputNames[0]];
    return Math.max(0, Math.min(1, Number(s.data[0]) || 0));
  }
}

// Decides from a stream of scores when the phrase has really been said: the score must reach the threshold, and after a detection it stays quiet for a while.
export class WakeGate {
  constructor({ threshold = 0.5, cooldownMs = 2500, now = () => Date.now() } = {}) { Object.assign(this, { threshold, cooldownMs, now }); this.last = -Infinity; }
  // -> true exactly when it should wake
  check(score) {
    const t = this.now();
    if (score < this.threshold || t - this.last < this.cooldownMs) return false;
    this.last = t;
    return true;
  }
}

export class Vad {
  // ort: the runtime; session: the loaded silero_vad.onnx
  constructor({ ort, session }) { Object.assign(this, { ort, session }); this.reset(); }
  reset() { this.state = new Float32Array(2 * 1 * 128); this.context = new Float32Array(64); }

  // block: Float32Array of 512 samples at 16 kHz, in -1..1. Returns the chance that someone is speaking (0..1).
  async push(block) {
    if (!block || block.length !== 512) throw new Error('a voice block is 512 samples');
    const { Tensor } = this.ort;
    const input = new Float32Array(576);
    input.set(this.context, 0); input.set(block, 64);
    const out = await this.session.run({ input: new Tensor('float32', input, [1, 576]), state: new Tensor('float32', this.state, [2, 1, 128]), sr: new Tensor('int64', BigInt64Array.from([16000n]), []) });
    this.state = Float32Array.from(out.stateN.data);
    this.context = block.slice(512 - 64);
    return Number(out.output.data[0]) || 0;
  }
}

// Turns "is someone speaking" per block into "they have finished": speech seen, then enough quiet. blockMs is the length of one block.
export class EndOfSpeech {
  constructor({ blockMs = 32, startProb = 0.5, endProb = 0.35, quietMs = 700, minSpeechMs = 200 } = {}) { Object.assign(this, { blockMs, startProb, endProb, quietMs, minSpeechMs }); this.reset(); }
  reset() { this.speechMs = 0; this.quiet = 0; this.started = false; }
  // -> 'speaking' | 'quiet' | 'done'
  push(prob) {
    if (prob >= this.startProb) { this.speechMs += this.blockMs; this.quiet = 0; if (this.speechMs >= this.minSpeechMs) this.started = true; return 'speaking'; }
    if (!this.started) return 'quiet';
    if (prob < this.endProb) this.quiet += this.blockMs; else this.quiet = 0;
    return this.quiet >= this.quietMs ? 'done' : 'quiet';
  }
}

export const BLOCK = FRAME;
