// Preview in a temporary workspace with no network and no writes outside it.
// The fixed WASM worker needs filesystem reads for Node, but mounts no host paths in OpenSCAD.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const ENGINE = '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD';
const WASM_ENGINE = path.join(os.homedir(), 'Library/Application Support/Relay/openscad-wasm/node_modules/@lofcz/openscad-wasm');
const WASM_WORKER = path.join(__dirname, 'scadWasmWorker.mjs');
const MAX_STL = 12 * 1024 * 1024;
const quote = p => JSON.stringify(p);
async function renderScad(source, { engine = ENGINE, wasmEngine = WASM_ENGINE, node = process.execPath, run = runFile, io = fs, tempRoot = os.tmpdir() } = {}) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1024 * 1024) throw Error('OpenSCAD source is invalid or too large.');
  const wasm = !io.existsSync(engine) && io.existsSync(path.join(wasmEngine, 'openscad.wasm'));
  if (!io.existsSync(engine) && !wasm) throw Error('OpenSCAD is not installed. Install it later to render a 3D preview; the text preview is still available.');
  if (!io.existsSync('/usr/bin/sandbox-exec')) throw Error('The macOS preview sandbox is unavailable; no file was executed.');
  const dir = io.realpathSync(io.mkdtempSync(path.join(tempRoot, 'relay-scad-preview-')));
  const input = path.join(dir, 'preview.scad'), output = path.join(dir, 'preview.stl');
  const executable = wasm ? node : engine;
  const reads = wasm ? '(allow file-read*)' : `(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Fonts") (subpath "/dev") (subpath "/private/etc") (subpath ${quote(path.dirname(path.dirname(path.dirname(engine))))}) (subpath ${quote(dir)}))`;
  const profile = `(version 1)(deny default)(allow process-exec (literal ${quote(executable)}))(allow process-fork)(allow sysctl-read)(allow mach-lookup)${reads}(allow file-write* (subpath ${quote(dir)}))(allow file-write-data (literal "/dev/null"))`;
  try {
    io.writeFileSync(input, source, { flag: 'wx', mode: 0o600 });
    const worker = path.join(dir, 'worker.mjs');
    if (wasm) io.writeFileSync(worker, io.readFileSync(WASM_WORKER), { flag: 'wx', mode: 0o600 });
    const args = wasm ? [worker, wasmEngine, input, output] : ['-o', output, input];
    await run('/usr/bin/sandbox-exec', ['-p', profile, executable, ...args], { timeout: 30000, maxBuffer: 32768, env: { HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', ELECTRON_RUN_AS_NODE: '1' } });
    const st = io.lstatSync(output);
    if (!st.isFile() || st.size < 84 || st.size > MAX_STL) throw Error('The renderer did not return a usable 3D model.');
    return io.readFileSync(output);
  } catch (e) {
    if (e.message === 'The renderer did not return a usable 3D model.') throw e;
    throw Error('OpenSCAD could not render this file in the isolated preview. External includes and imports are unavailable.');
  } finally { io.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { renderScad, ENGINE, MAX_STL };
