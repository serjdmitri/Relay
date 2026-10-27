// A model as a file for a 3D printer or a CAD app. The input is plain triangles: a Float32Array with 9 numbers per triangle (x y z for each
// corner), in millimetres, with z up (what slicers and CAD apps expect). STL and 3MF are what slicers read; STEP is for CAD apps like Fusion
// (the triangles become the faces of a faceted solid). No three.js in here, so it can be tested on its own.

const enc = new TextEncoder();
const f = (n) => (Math.abs(n) < 1e-9 ? '0' : String(+n.toFixed(5)));

// Binary STL.
export function toStl(tris, name = 'Relay') {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(enc.encode(`Relay ${name}`.slice(0, 79)));
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const o = i * 9, p = 84 + i * 50;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(p, nx, true); dv.setFloat32(p + 4, ny, true); dv.setFloat32(p + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(p + 12 + k * 4, tris[o + k], true);
  }
  return new Uint8Array(buf);
}

// ---- a zip with nothing compressed (3MF is a zip) ----
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) { // files: [{ name, bytes }]
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nm = enc.encode(name);
    const crc = crc32(bytes);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0, true); head.setUint16(8, 0, true); head.setUint16(10, 0, true); head.setUint16(12, 0x21, true);
    head.setUint32(14, crc, true); head.setUint32(18, bytes.length, true); head.setUint32(22, bytes.length, true); head.setUint16(26, nm.length, true); head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), nm, bytes);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + bytes.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// Triangles sharing corners: one list of points and index triples.
export function indexed(tris) {
  const map = new Map();
  const pts = [];
  const idx = [];
  for (let i = 0; i < tris.length; i += 3) {
    const k = `${Math.round(tris[i] * 1e4)},${Math.round(tris[i + 1] * 1e4)},${Math.round(tris[i + 2] * 1e4)}`;
    let v = map.get(k);
    if (v === undefined) { v = pts.length / 3; map.set(k, v); pts.push(tris[i], tris[i + 1], tris[i + 2]); }
    idx.push(v);
  }
  return { pts, idx };
}

// 3MF: what Bambu Studio, PrusaSlicer, OrcaSlicer, Cura and Fusion read; keeps the size in millimetres.
export function to3mf(tris, name = 'Relay model') {
  const { pts, idx } = indexed(tris);
  const verts = [];
  for (let i = 0; i < pts.length; i += 3) verts.push(`<vertex x="${f(pts[i])}" y="${f(pts[i + 1])}" z="${f(pts[i + 2])}"/>`);
  const faces = [];
  for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) faces.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
  const esc = (s) => String(s).replace(/[<>&"']/g, '');
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(name)}</metadata><metadata name="Application">Relay</metadata><resources><object id="1" type="model" name="${esc(name)}"><mesh><vertices>${verts.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  return zipStore([
    { name: '[Content_Types].xml', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', bytes: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', bytes: enc.encode(model) }
  ]);
}

// STEP (AP214): a real B-rep solid, every triangle a planar face with its edges shared with its neighbours, so CAD apps (Fusion, FreeCAD,
// SolidWorks) read it as a solid. Big meshes make big files, so it is for models up to about 20,000 triangles.
export const STEP_MAX_TRIS = 20000;
export function toStep(tris, name = 'Relay model') {
  const n = tris.length / 9;
  if (n > STEP_MAX_TRIS) throw new Error(`That model has ${n.toLocaleString('en-US')} triangles: too detailed for STEP. Save it as 3MF or STL instead.`);
  const { pts, idx } = indexed(tris);
  const L = [];
  let id = 0;
  const add = (s) => { L.push(`#${++id}=${s};`); return id; };
  const label = String(name).replace(/[^\w .-]/g, '').slice(0, 60) || 'Relay model';
  const P = (i) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
  const pointId = [], vertexId = [];
  for (let i = 0; i < pts.length / 3; i++) { const p = P(i); pointId.push(add(`CARTESIAN_POINT('',(${f(p[0])},${f(p[1])},${f(p[2])}))`)); vertexId.push(add(`VERTEX_POINT('',#${pointId[i]})`)); }
  const unit = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dirId = (v) => add(`DIRECTION('',(${f(v[0])},${f(v[1])},${f(v[2])}))`);
  const edges = new Map();
  const edgeOf = (u, v) => {
    const a = Math.min(u, v), b = Math.max(u, v), k = `${a}-${b}`;
    let e = edges.get(k);
    if (!e) {
      const pa = P(a), pb = P(b), d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const vec = add(`VECTOR('',#${dirId(unit(d))},${f(Math.hypot(...d))})`);
      const line = add(`LINE('',#${pointId[a]},#${vec})`);
      e = { id: add(`EDGE_CURVE('',#${vertexId[a]},#${vertexId[b]},#${line},.T.)`), a };
      edges.set(k, e);
    }
    return add(`ORIENTED_EDGE('',*,*,#${e.id},${u === e.a ? '.T.' : '.F.'})`);
  };
  const faces = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
    if (i === j || j === k || i === k) continue;
    const p0 = P(i), p1 = P(j), p2 = P(k);
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nrm = unit([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    if (!Number.isFinite(nrm[0]) || (nrm[0] === 0 && nrm[1] === 0 && nrm[2] === 0)) continue;
    const place = add(`AXIS2_PLACEMENT_3D('',#${pointId[i]},#${dirId(nrm)},#${dirId(unit(u))})`);
    const plane = add(`PLANE('',#${place})`);
    const loop = add(`EDGE_LOOP('',(#${edgeOf(i, j)},#${edgeOf(j, k)},#${edgeOf(k, i)}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    faces.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
  }
  const shell = add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`);
  const brep = add(`MANIFOLD_SOLID_BREP('${label}',#${shell})`);
  const origin = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const axis = add(`AXIS2_PLACEMENT_3D('',#${origin},#${add("DIRECTION('',(0.,0.,1.))")},#${add("DIRECTION('',(1.,0.,0.))")})`);
  const lenU = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const angU = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const solU = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.001),#${lenU},'distance_accuracy_value','')`);
  const ctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenU},#${angU},#${solU}))REPRESENTATION_CONTEXT('',''))`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${axis},#${brep}),#${ctx})`);
  const app = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`);
  const pc = add(`PRODUCT_CONTEXT('',#${app},'mechanical')`);
  const prod = add(`PRODUCT('${label}','${label}','',(#${pc}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  const head = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('${label}'),'2;1');\nFILE_NAME('${label}.step','${new Date().toISOString().slice(0, 19)}',(''),(''),'Relay','Relay','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n`;
  return enc.encode(`${head}${L.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`);
}

// y up (how the holograms are drawn) to z up (how printers and CAD apps stand a part), and the model dropped onto the bed (lowest point at z = 0).
export function zUp(tris, { scaleTo = 0 } = {}) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) { out[i] = tris[i]; out[i + 1] = -tris[i + 2]; out[i + 2] = tris[i + 1]; }
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < out.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], out[i + k]); max[k] = Math.max(max[k], out[i + k]); }
  const big = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-9);
  const s = scaleTo ? scaleTo / big : 1;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  for (let i = 0; i < out.length; i += 3) { out[i] = (out[i] - cx) * s; out[i + 1] = (out[i + 1] - cy) * s; out[i + 2] = (out[i + 2] - min[2]) * s; }
  return out;
}

// Will it print? tris: z up, on the bed (what zUp gives), in millimetres. Reports the size, whether the skin is closed (a slicer needs that), how much
// of it hangs out over nothing (more than 45 degrees past straight up needs supports), and the volume of a closed model.
export function printCheck(tris, { minOverhang = 45 } = {}) {
  const n = Math.floor(tris.length / 9);
  if (!n) return null;
  const { pts, idx } = indexed(tris);
  const edges = new Map();
  const bump = (a, b) => { const k = a < b ? a * pts.length + b : b * pts.length + a; edges.set(k, (edges.get(k) || 0) + 1); };
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pts[i + k]); max[k] = Math.max(max[k], pts[i + k]); }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const cosLimit = -Math.cos((minOverhang * Math.PI) / 180); // a face whose normal points down further than this overhangs
  let area = 0, hang = 0, vol = 0;
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    if (idx[t * 3] !== idx[t * 3 + 1] && idx[t * 3 + 1] !== idx[t * 3 + 2] && idx[t * 3] !== idx[t * 3 + 2]) { bump(idx[t * 3], idx[t * 3 + 1]); bump(idx[t * 3 + 1], idx[t * 3 + 2]); bump(idx[t * 3 + 2], idx[t * 3]); }
    const ux = pts[b] - pts[a], uy = pts[b + 1] - pts[a + 1], uz = pts[b + 2] - pts[a + 2];
    const vx = pts[c] - pts[a], vy = pts[c + 1] - pts[a + 1], vz = pts[c + 2] - pts[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!l) continue;
    area += l / 2;
    const onBed = Math.max(pts[a + 2], pts[b + 2], pts[c + 2]) - min[2] < size[2] * 0.004 + 1e-6;
    if (nz / l < cosLimit && !onBed) hang += l / 2;
    vol += (pts[a] * (pts[b + 1] * pts[c + 2] - pts[b + 2] * pts[c + 1]) - pts[a + 1] * (pts[b] * pts[c + 2] - pts[b + 2] * pts[c]) + pts[a + 2] * (pts[b] * pts[c + 1] - pts[b + 1] * pts[c])) / 6;
  }
  let open = 0, bad = 0;
  for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) bad++; }
  const closed = open === 0 && bad === 0;
  const overhangPct = area ? Math.round((hang / area) * 100) : 0;
  const notes = [];
  notes.push(closed ? 'The skin is closed, so a slicer can fill it.' : `The skin has ${open + bad} open or doubled ${open + bad === 1 ? 'edge' : 'edges'}: a slicer may fail or leave holes. Repair it in the slicer (most have a button for that).`);
  notes.push(overhangPct < 5 ? 'Almost nothing hangs over empty space.' : overhangPct < 20 ? `${overhangPct}% of the surface overhangs: a few supports.` : `${overhangPct}% of the surface overhangs: it needs supports, or turn it to a flatter side.`);
  return { sizeMm: size.map((v) => +v.toFixed(1)), triangles: n, closed, openEdges: open, doubledEdges: bad, overhangPct, volumeCm3: closed ? +(Math.abs(vol) / 1000).toFixed(2) : null, notes };
}
