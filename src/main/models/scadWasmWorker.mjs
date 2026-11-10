import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [engine, input, output] = process.argv.slice(2);
const { default: createOpenSCAD } = await import(pathToFileURL(path.join(engine, 'openscad.js')).href);
const wasmBytes = fs.readFileSync(path.join(engine, 'openscad.wasm'));
const instance = await createOpenSCAD({ noInitialRun: true, instantiateWasm(imports, done) {
  WebAssembly.instantiate(wasmBytes, imports).then(r => done(r.instance)); return {};
} });
instance.FS.writeFile('/input.scad', fs.readFileSync(input));
const code = instance.callMain(['/input.scad', '--backend', 'Manifold', '--export-format', 'binstl', '-o', '/out.stl']);
if (code !== 0) throw Error('OpenSCAD render failed');
fs.writeFileSync(output, instance.FS.readFile('/out.stl'), { flag: 'wx', mode: 0o600 });
