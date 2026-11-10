// Runs in the audio thread: gathers the microphone into blocks of 1280 samples (80 ms at 16 kHz) on the 16-bit scale and hands them to the page.
class BlockCollector extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1280); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = Math.max(-32768, Math.min(32767, ch[i] * 32768));
      if (this.n === 1280) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('block-collector', BlockCollector);
