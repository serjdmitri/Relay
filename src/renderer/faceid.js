// Owner recognition, camera side: turns a face the finder found into 128 numbers with the SFace model (on this Mac, through onnxruntime-web). Used by
// presence.js only while owner recognition is on or you are enrolling. A picture is never kept or sent; only these numbers (and, for matching, a score) are.
import * as ort from './vendor/faceid/ort.wasm.min.mjs';
import { alignFromKeypoints, toPlanar } from './facealign.js';

export async function createEmbedder() {
  ort.env.wasm.wasmPaths = new URL('./vendor/faceid/', import.meta.url).href;
  ort.env.wasm.numThreads = 1; // the page is not cross-origin isolated, so no worker threads
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(new URL('./vendor/faceid/face_recognition_sface_2021dec_int8.onnx', import.meta.url).href, { executionProviders: ['wasm'] });
  const input = session.inputNames[0], output = session.outputNames[0];
  const canvas = document.createElement('canvas'); canvas.width = 112; canvas.height = 112;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // detection: one entry of FaceDetector's result (with its keypoints). Returns an array of 128 numbers, or null when the face is too small or turned away.
  return async function embed(video, detection) {
    const t = alignFromKeypoints(detection?.keypoints, video.videoWidth, video.videoHeight);
    if (!t) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 112, 112);
    ctx.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pixels = ctx.getImageData(0, 0, 112, 112).data;
    const out = await session.run({ [input]: new ort.Tensor('float32', toPlanar(pixels), [1, 3, 112, 112]) });
    const v = Array.from(out[output].data);
    return v.length === 128 && v.every(Number.isFinite) ? v : null;
  };
}
