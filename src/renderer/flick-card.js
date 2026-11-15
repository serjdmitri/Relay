// The page of a flicked-photo card: shows the picture and its file name, and turns button presses into requests to the app (flickCards.js does the work).
// Cropping is drawn here (the page knows how the photo is rotated); the app keeps the cut-out beside the original.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.flickCard;
  const pic = $('pic'), wrap = $('imgwrap'), sel = $('sel');
  let st = null, mode = 'main', rect = null, drag = null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const say = (text, bad = false) => { $('msg').textContent = text || ''; $('msg').className = bad ? 'bad' : ''; };
  const fileSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  function setMode(m) {
    mode = m; rect = null; sel.hidden = true; $('keep').disabled = true;
    if (m === 'crop' || m === 'type') say('');
    $('bar-main').hidden = m !== 'main'; $('bar-crop').hidden = m !== 'crop'; $('bar-type').hidden = m !== 'type';
    $('name').hidden = m === 'rename'; $('info').hidden = m === 'rename'; $('rename').hidden = m !== 'rename';
    wrap.classList.toggle('cropping', m === 'crop');
    if (m === 'rename') { $('rename').value = st ? st.base : ''; $('rename').focus(); $('rename').select(); }
    if (m === 'type') document.querySelectorAll('[data-format]').forEach((b) => { b.disabled = !!st && b.dataset.format === st.ext; });
  }

  // runs a request and shows what came back
  async function run(req) {
    let r;
    try { r = await api.act(req); } catch { r = { ok: false, error: 'That did not work.' }; }
    if (r && r.ok === false) say(r.error || 'That did not work.', true);
    else if (r && typeof r.message === 'string') say(r.message);
    return r;
  }

  api.onState((s) => {
    st = s;
    $('base').textContent = s.base; $('ext').textContent = String(s.ext || '').toUpperCase(); $('info').textContent = fileSize(s.size || 0);
    $('name').title = s.name;
    if (s.intro && s.bytes) { pendingIntro = s; wrap.classList.add('intro'); } // the first time: the hologram reveal plays once the card is shown
    pic.src = s.url;
  });

  // The hologram reveal: the photo first appears only as light (its outlines picked out in cyan, scan lines running over it), then its real colours flood up from the bottom.
  // The same picture as the hologram windows draw (holo.js), drawn here with plain WebGL.
  const VERT = 'attribute vec2 p; varying vec2 vUv; void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = 'precision mediump float; uniform sampler2D map; uniform vec2 texel; uniform float fill; uniform float time; varying vec2 vUv;' +
    'float lum(vec2 st, vec2 o) { return dot(texture2D(map, st + o).rgb, vec3(0.299, 0.587, 0.114)); }' +
    'void main() { vec2 st = vec2(vUv.x, 1.0 - vUv.y); vec3 col = texture2D(map, st).rgb;' +
    ' float a = lum(st, vec2(-texel.x, -texel.y)), b = lum(st, vec2(0.0, -texel.y)), c = lum(st, vec2(texel.x, -texel.y)), d = lum(st, vec2(-texel.x, 0.0)), f = lum(st, vec2(texel.x, 0.0)), g = lum(st, vec2(-texel.x, texel.y)), h = lum(st, vec2(0.0, texel.y)), i = lum(st, vec2(texel.x, texel.y));' +
    ' float gx = (c + 2.0 * f + i) - (a + 2.0 * d + g), gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);' +
    ' float edge = smoothstep(0.08, 0.5, length(vec2(gx, gy)) * 2.0);' +
    ' float l = dot(col, vec3(0.299, 0.587, 0.114)); float scan = 0.7 + 0.3 * sin(vUv.y * 120.0 - time * 4.0);' +
    ' vec3 holo = vec3(0.05, 0.55, 0.8) * (0.15 + 0.7 * l) * scan + vec3(0.35, 0.95, 1.0) * edge * 1.2;' +
    ' float holoA = clamp(0.28 + 0.5 * l + edge, 0.0, 0.95);' +
    ' float k = 1.0 - smoothstep(fill - 0.07, fill, vUv.y);' +
    ' float line = exp(-abs(vUv.y - fill) * 38.0) * step(0.001, fill) * step(fill, 1.08);' +
    ' vec3 rgb = mix(holo, col * 1.15, k) + vec3(0.3, 0.9, 1.0) * line * 0.9;' +
    ' float alpha = min(1.0, mix(holoA, 1.0, k) + line * 0.6);' +
    ' gl_FragColor = vec4(rgb * (0.97 + 0.03 * sin(time * 37.0)) * alpha, alpha); }';

  let pendingIntro = null;
  const endIntro = () => { wrap.classList.remove('intro'); const cv = $('holo'); cv.style.opacity = '0'; setTimeout(() => { cv.hidden = true; }, 500); };

  async function playIntro(s) {
    const cv = $('holo');
    try {
      const whole = await createImageBitmap(new Blob([s.bytes], { type: s.mime || 'image/jpeg' }));
      const k = Math.min(1, 760 / Math.max(whole.width, whole.height));
      const bm = k < 1 ? await createImageBitmap(whole, { resizeWidth: Math.max(1, Math.round(whole.width * k)), resizeHeight: Math.max(1, Math.round(whole.height * k)), resizeQuality: 'high' }) : whole;
      const dpr = window.devicePixelRatio || 1, box = wrap.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(box.width * dpr)); cv.height = Math.max(1, Math.round(box.height * dpr)); cv.style.opacity = '1'; cv.hidden = false;
      const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true });
      if (!gl) throw new Error('no webgl');
      const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      gl.uniform2f(gl.getUniformLocation(prog, 'texel'), 1 / bm.width, 1 / bm.height);
      const uFill = gl.getUniformLocation(prog, 'fill'), uTime = gl.getUniformLocation(prog, 'time');
      gl.viewport(0, 0, cv.width, cv.height); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const t0 = performance.now();
      const frame = (now) => {
        const t = now - t0, q = Math.min(1, Math.max(0, (t - 1800) / 2200)); // the colours start about two seconds in, then flood up over two more
        gl.uniform1f(uFill, (q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2) * 1.12); gl.uniform1f(uTime, t / 1000);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (t < 4300) requestAnimationFrame(frame); else endIntro();
      };
      requestAnimationFrame(frame);
    } catch { endIntro(); } // no reveal: the photo simply shows
  }

  // the picture is loaded: tell the app how big it really is, so the card is sized to it (and shown the first time)
  pic.addEventListener('load', async () => {
    const r = await api.act({ action: 'loaded', w: pic.naturalWidth, h: pic.naturalHeight });
    if (r && r.imgW) { wrap.style.width = r.imgW + 'px'; wrap.style.height = r.imgH + 'px'; }
    document.body.classList.add('in');
    if (pendingIntro) { const s = pendingIntro; pendingIntro = null; playIntro(s); }
  });
  pic.addEventListener('error', async () => {
    await api.act({ action: 'loaded', w: 0, h: 0 });
    say('Could not show this photo, but it is saved in Downloads.', true);
    document.body.classList.add('in');
    pendingIntro = null; wrap.classList.remove('intro');
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'x') { api.act({ action: 'close' }); return; }
    if (b.dataset.mode) { setMode(b.dataset.mode); return; }
    if (b.dataset.format) { setMode('main'); say('Changing the file type…'); run({ action: 'convert', format: b.dataset.format }); return; }
    if (b.dataset.act === 'share') { const r = b.getBoundingClientRect(); run({ action: 'share', x: r.left, y: r.bottom }); return; }
    if (b.dataset.act === 'copy') { copyPicture(); return; }
    if (b.dataset.act) { run({ action: b.dataset.act }); return; }
    if (b.id === 'cropcancel' || b.id === 'typeback') { setMode('main'); return; }
    if (b.id === 'keep') keepCrop();
  });

  $('name').addEventListener('dblclick', () => setMode('rename'));
  $('rename').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const name = $('rename').value; setMode('main'); await run({ action: 'rename', name }); }
    else if (e.key === 'Escape') { e.stopPropagation(); setMode('main'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (mode !== 'main') setMode('main'); else api.act({ action: 'close' }); } });

  // crop: drag a rectangle over the picture
  const paint = () => { if (!rect) { sel.hidden = true; return; } sel.hidden = false; Object.assign(sel.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' }); };
  wrap.addEventListener('pointerdown', (e) => {
    if (mode !== 'crop') return;
    const b = wrap.getBoundingClientRect();
    drag = { x: clamp(e.clientX - b.left, 0, b.width), y: clamp(e.clientY - b.top, 0, b.height), b };
    try { wrap.setPointerCapture(e.pointerId); } catch { /* the drag still works while the pointer stays over the photo */ }
    rect = null; paint(); $('keep').disabled = true;
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = clamp(e.clientX - drag.b.left, 0, drag.b.width), y = clamp(e.clientY - drag.b.top, 0, drag.b.height);
    rect = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
    paint();
  });
  wrap.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    if (rect && rect.w > 12 && rect.h > 12) $('keep').disabled = false; else { rect = null; paint(); }
  });

  // copy: the picture as drawn here (the right way up), at most 4096 pixels on its longest side
  async function copyPicture() {
    try {
      const k = Math.min(1, 4096 / Math.max(pic.naturalWidth, pic.naturalHeight, 1));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(pic.naturalWidth * k)); c.height = Math.max(1, Math.round(pic.naturalHeight * k));
      c.getContext('2d').drawImage(pic, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      if (blob) { run({ action: 'copy', bytes: new Uint8Array(await blob.arrayBuffer()) }); return; }
    } catch { /* the app reads the file instead */ }
    run({ action: 'copy' });
  }

  async function keepCrop() {
    if (!rect) return;
    const b = wrap.getBoundingClientRect(), nw = pic.naturalWidth, nh = pic.naturalHeight;
    const sx = Math.round((rect.x / b.width) * nw), sy = Math.round((rect.y / b.height) * nh);
    const sw = Math.max(1, Math.round((rect.w / b.width) * nw)), sh = Math.max(1, Math.round((rect.h / b.height) * nh));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(pic, sx, sy, sw, sh, 0, 0, sw, sh);
    const png = !!st && (st.ext === 'png' || st.ext === 'gif'); // these keep their see-through parts; everything else becomes a JPEG
    const blob = await new Promise((resolve) => c.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.92));
    if (!blob) { say('Could not crop that.', true); return; }
    setMode('main'); say('Cropping…');
    await run({ action: 'crop', bytes: new Uint8Array(await blob.arrayBuffer()), type: png ? 'png' : 'jpg' });
  }

  setMode('main');
})();
