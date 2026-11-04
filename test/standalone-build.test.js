const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { build } = require('../scripts/build-standalone');
const ROOT = path.join(__dirname, '..');
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]).sort();

test('the standalone page is built from the phone page, with relative paths, no Mac, and only secure connections', () => {
  const out = build(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-standalone-')));
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /<html lang="en" data-standalone="1">/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'no absolute paths: it is served from a sub-folder');
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost/, 'nothing about a local server');
  assert.match(html, /connect-src 'self' https:;/);
  assert.match(html, /rel="manifest"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone'); assert.ok(fs.existsSync(path.join(out, manifest.icons[0].src)));
  // every file the page loads is there
  for (const ref of [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((r) => !/^https?:/.test(r))) assert.ok(fs.existsSync(path.join(out, ref)), 'missing ' + ref);
  const js = fs.readFileSync(path.join(out, 'navigation.js'), 'utf8');
  for (const ref of [...js.matchAll(/(?:from|import\()\s*'(\.\/[^']+)'/g)].map((m) => m[1])) assert.ok(fs.existsSync(path.join(out, ref)), 'missing import ' + ref);
  assert.doesNotMatch(js, /from '\/|import\('\//, 'imports are relative');
  assert.ok(fs.existsSync(path.join(out, 'maplibre', 'LICENSE.txt')), 'the map library licence travels with it');
  fs.rmSync(out, { recursive: true, force: true });
});

test('the published docs/nav folder is the current build (run npm run build:standalone after changing the phone page)', () => {
  const committed = path.join(ROOT, 'docs', 'nav');
  assert.ok(fs.existsSync(committed), 'docs/nav is missing: run npm run build:standalone');
  const out = build(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-standalone-')));
  assert.deepEqual(walk(committed), walk(out));
  for (const f of walk(out)) assert.ok(fs.readFileSync(path.join(committed, f)).equals(fs.readFileSync(path.join(out, f))), f + ' is out of date');
  fs.rmSync(out, { recursive: true, force: true });
});
