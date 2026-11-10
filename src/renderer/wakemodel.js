/* global relay */
// The page behind "Hey Jarvis": microphone -> 16 kHz blocks -> the wake model (and a voice detector while Relay is listening to you). It tells the app
// when it heard the phrase, and, only while Relay is listening to a request, how likely it is that a person (not a fan or a TV) is speaking.
import * as ort from './vendor/faceid/ort.wasm.min.mjs';
import { WakeEngine, WakeGate, Vad, BLOCK } from './wakeengine.js';

const tell = (state, message) => { try { relay.wakeModelStatus({ state, message }); } catch { /* the page may be closing */ } };

async function start() {
  ort.env.wasm.wasmPaths = new URL('./vendor/faceid/', import.meta.url).href;
  ort.env.wasm.numThreads = 1; // the page is not cross-origin isolated, so no worker threads
  ort.env.wasm.proxy = false;
  const load = (f) => ort.InferenceSession.create(new URL('./vendor/wake/' + f, import.meta.url).href, { executionProviders: ['wasm'] });
  const [mel, emb, clf, vadSession] = await Promise.all([load('melspectrogram.onnx'), load('embedding_model.onnx'), load('hey_jarvis_v0.1.onnx'), load('silero_vad.onnx')]);
  const cfg = (await relay.wakeModelConfig().catch(() => ({}))) || {};
  const engine = new WakeEngine({ ort, mel, emb, clf });
  const gate = new WakeGate({ threshold: Math.max(0.2, Math.min(0.9, Number(cfg.threshold) || 0.5)), cooldownMs: 2500 });
  const vad = new Vad({ ort, session: vadSession });

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule(new URL('./wakemodel-worklet.js', import.meta.url).href);
  const node = new AudioWorkletNode(ctx, 'block-collector');
  ctx.createMediaStreamSource(stream).connect(node); // not connected to the speakers
  stream.getAudioTracks()[0]?.addEventListener('ended', () => tell('error', 'The microphone stopped.'));

  let watchUntil = 0, busy = false, backlog = [];
  relay.onWakeModelWatch(() => { watchUntil = Date.now() + 1500; });

  async function handle(block) {
    const score = await engine.push(block);
    if (gate.check(score)) { try { relay.wakeModelHeard({ score }); } catch { /* closing */ } engine.reset(); }
    if (Date.now() < watchUntil) {
      let p = 0;
      for (let i = 0; i + 512 <= BLOCK; i += 512) p = Math.max(p, await vad.push(block.slice(i, i + 512).map((x) => x / 32768)));
      try { relay.wakeModelVoice({ p }); } catch { /* closing */ }
    } else vad.reset();
  }
  async function drain() {
    if (busy) return;
    busy = true;
    try { while (backlog.length) { const b = backlog.shift(); if (backlog.length > 6) { backlog = backlog.slice(-3); } await handle(b); } } catch (e) { tell('error', 'The listener stopped: ' + String(e && e.message || e).slice(0, 100)); } finally { busy = false; }
  }
  node.port.onmessage = (e) => { backlog.push(e.data); drain(); };
  if (ctx.state === 'suspended') await ctx.resume();
  tell('listening');
}

start().catch((e) => tell('error', String((e && e.message) || e).slice(0, 140)));
