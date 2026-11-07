// The camera window's page: shows the camera, draws nothing else, keeps nothing. window.__cameraShot() hands the app one picture when Jarvis is asked what it sees.
const video = document.getElementById('v'), msg = document.getElementById('msg');
let stream = null;

document.getElementById('x').onclick = () => window.close();
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
addEventListener('pagehide', () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ } });

window.__cameraShot = () => {
  try {
    const w = video.videoWidth || 0, h = video.videoHeight || 0;
    if (!w || !h || video.readyState < 2) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(video, 0, 0, w, h);
    return { jpeg: c.toDataURL('image/jpeg', 0.8), at: Date.now() };
  } catch { return null; }
};

(async () => {
  try {
    const asked = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: { ideal: 30 } }, audio: false });
    stream = await Promise.race([asked, new Promise((_, no) => setTimeout(() => no(new Error('CameraTimeout')), 15000))]);
    video.srcObject = stream; await video.play(); msg.textContent = '';
  } catch (e) {
    const m = String(e?.message || e);
    msg.textContent = /CameraTimeout/.test(m) ? 'The camera did not answer. Another app may be using it.' : /Permission|NotAllowed/i.test(m) ? 'Relay may not use the camera. Allow it in System Settings > Privacy & Security > Camera.' : 'The camera could not start.';
  }
})();
