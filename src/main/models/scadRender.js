// Preview OpenSCAD in an isolated temporary workspace. No user files or network are available to the renderer.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const ENGINE = '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD';
const MAX_STL = 12 * 1024 * 1024;
const quote = p => JSON.stringify(p);
async function renderScad(source, { engine = ENGINE, run = runFile, io = fs, tempRoot = os.tmpdir() } = {}) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1024 * 1024) throw Error('OpenSCAD source is invalid or too large.');
  if (!io.existsSync(engine)) throw Error('OpenSCAD is not installed. Install it later to render a 3D preview; the text preview is still available.');
  if (!io.existsSync('/usr/bin/sandbox-exec')) throw Error('The macOS preview sandbox is unavailable; no file was executed.');
  const dir = io.realpathSync(io.mkdtempSync(path.join(tempRoot, 'relay-scad-preview-')));
  const input = path.join(dir, 'preview.scad'), output = path.join(dir, 'preview.stl');
  const profile = `(version 1)(deny default)(allow process-exec (literal ${quote(engine)}))(allow process-fork)(allow sysctl-read)(allow mach-lookup)(allow file-read* (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Fonts") (subpath "/dev") (subpath "/private/etc") (subpath ${quote(path.dirname(path.dirname(path.dirname(engine))))}) (subpath ${quote(dir)}))(allow file-write* (subpath ${quote(dir)}))(allow file-write-data (literal "/dev/null"))`;
  try {
    io.writeFileSync(input, source, { flag: 'wx', mode: 0o600 });
    await run('/usr/bin/sandbox-exec', ['-p', profile, engine, '-o', output, input], { timeout: 30000, maxBuffer: 32768, env: { HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    const st = io.lstatSync(output);
    if (!st.isFile() || st.size < 84 || st.size > MAX_STL) throw Error('The renderer did not return a usable 3D model.');
    return io.readFileSync(output);
  } catch (e) {
    if (e.message === 'The renderer did not return a usable 3D model.') throw e;
    throw Error('OpenSCAD could not render this file in the isolated preview. External includes and imports are unavailable.');
  } finally { io.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { renderScad, ENGINE, MAX_STL };
