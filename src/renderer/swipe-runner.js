/* global relay */
// Watches for the two-finger swipe on the camera that Presence already runs (no second camera, and the Hands feature stays off). It looks for a hand a few times a second while you are in view,
// and speeds up to about 30 pictures a second while a hand is there, so the swipe reacts at once. Only the 21 hand points are used (swipe.js); no picture leaves this page.
import { GestureRecognizer, FilesetResolver } from './vendor/mediapipe/vision_bundle.mjs';
import { TwoFingerSwipe } from './swipe.js';

export function createSwipeRunner({ video, isFacePresent = () => true }) {
  let recognizer = null, loading = false, failed = false, timer = 0, stopped = false, running = false;
  let detector = new TwoFingerSwipe(), cfgKey = '', lastHandAt = 0;

  async function load() {
    loading = true;
    try {
      const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
      const make = (delegate) => GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: './vendor/mediapipe/gesture_recognizer.task', delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { recognizer = await make('GPU'); } catch { recognizer = await make('CPU'); }
    } catch (e) { failed = true; try { relay.presenceSwipe({ error: String((e && e.message) || e).slice(0, 120) }); } catch { /* closing */ } } finally { loading = false; }
  }

  function tick() {
    timer = 0;
    if (stopped || !running) return;
    let next = 125; // looking for a hand: 8 a second
    try {
      if (recognizer && video.readyState >= 2 && isFacePresent()) {
        const r = recognizer.recognizeForVideo(video, performance.now());
        const l = r.landmarks && r.landmarks[0];
        const now = Date.now();
        if (l) lastHandAt = now;
        const e = detector.push(l || null, now);
        if (e) { try { relay.presenceSwipe(e); } catch { /* closing */ } }
        if (now - lastHandAt < 1500) next = 33; // a hand is there (or just was): about 30 a second
      } else if (!isFacePresent()) next = 500; // nobody at the Mac: hardly look
    } catch { /* one bad picture */ }
    timer = setTimeout(tick, next);
  }

  return {
    // cfg: { leftDeg, rightDeg, mirrored } from the app, or null when the swipe is off
    update(cfg) {
      if (!cfg) { this.stop(); return; }
      const key = JSON.stringify(cfg);
      if (key !== cfgKey) { cfgKey = key; detector = new TwoFingerSwipe({ leftDeg: cfg.leftDeg, rightDeg: cfg.rightDeg, mirrored: !!cfg.mirrored, aspect: (video.videoWidth || 4) / (video.videoHeight || 3), onStage: (stage) => { try { relay.presenceSwipe({ type: 'stage', stage }); } catch { /* closing */ } } }); }
      running = true;
      if (!recognizer && !loading && !failed) load();
      if (!timer) timer = setTimeout(tick, 125);
    },
    stop() { running = false; clearTimeout(timer); timer = 0; cfgKey = ''; },
    close() { stopped = true; this.stop(); try { recognizer && recognizer.close(); } catch { /* gone */ } recognizer = null; }
  };
}
