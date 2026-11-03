// A safety net for a bug the other tests cannot see: a main-process file that uses a Node module name (fs, path, os, crypto...) it never imported. The tests stub
// Electron and never start the real app, so such a file passes every test and then throws "fs is not defined" while the app starts, which leaves Relay's window blank
// (0.38.0 to 0.38.1 shipped like that). This reads the source text of every main-process file and fails if it uses one of these names without declaring it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../src/main');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");

// name -> how it is normally brought in
const MODULES = ['fs', 'path', 'os', 'crypto', 'child_process', 'url', 'http', 'https', 'net', 'dns'];
const USE = (n) => new RegExp(`(?<![\\w.$])${n}\\.(?:[A-Za-z_]\\w*)\\s*\\(`);
const DECLARED = (n) => new RegExp(`(?:\\b(?:const|let|var)\\s+${n}\\s*=|\\b(?:const|let|var)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=|\\bfunction\\s*\\w*\\s*\\([^)]*\\b${n}\\b[^)]*\\)|\\(\\s*${n}\\s*[,)=]|[,(]\\s*${n}\\s*\\)?\\s*=>|\\{\\s*${n}\\s*[,}]|,\\s*${n}\\s*[,}]|[,;]\\s*${n}\\s*=\\s*require\\()`);

test('no main-process file uses a Node module name it never declared', () => {
  const bad = [];
  for (const file of walk(ROOT)) {
    const raw = fs.readFileSync(file, 'utf8'), code = strip(raw);
    for (const n of MODULES) if (USE(n).test(code) && !DECLARED(n).test(code)) bad.push(`${path.relative(ROOT, file)} uses ${n}. without declaring it`);
  }
  assert.deepEqual(bad, []);
});

test('the check itself works: it flags a bare fs use and accepts the usual ways of declaring one', () => {
  const flags = (src) => MODULES.some((n) => USE(n).test(strip(src)) && !DECLARED(n).test(strip(src)));
  assert.equal(flags("const x = fs.existsSync('/a');"), true);
  for (const ok of ["const fs = require('fs'); fs.existsSync('/a');", "const { fs } = deps; fs.existsSync('/a');", "function f(fs) { return fs.existsSync('/a'); }", "const os=require('os'),fs=require('fs'); fs.existsSync('/a');", "run(({ fs }) => fs.readFileSync('x'))", "// fs.existsSync is only mentioned here\nconst y = 1;", "const s = 'fs.existsSync(';"]) assert.equal(flags(ok), false, ok);
});
