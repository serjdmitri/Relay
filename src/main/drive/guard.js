// The rules that keep Relay from losing anything of yours. Relay never deletes a file: the most it can do is move one to the Trash (where you
// can take it back), and it never empties the Trash. These checks run on every path a tool is given and on every command or script it is
// asked to run, whoever asked for it. No Electron in here, so it can be tested.

const path = require('path');

const NEVER_DELETE = 'Relay never deletes files. It can move them to a folder, or to the Trash if you ask, and it never empties the Trash.';

// Commands that remove or destroy data, in a shell command or a script that runs one.
const DESTROYERS = [
  /(?:^|[\s;&|(`$"'])(?:sudo\s+)?(?:\/bin\/|\/usr\/bin\/)?(?:rm|rmdir|unlink|srm|shred)(?=[\s;|)`"']|$)/,
  /\bfind\b[^|;&]*\s-delete\b/,
  /\bfind\b[^|;&]*-exec\s+(?:sudo\s+)?(?:\/bin\/)?(?:rm|rmdir|unlink|shred)\b/,
  /\btruncate\b/,
  /\bdiskutil\s+(?:erase|reformat|partition|zero|secure|apfs\s+delete)/i,
  /\bdd\b[^|;&]*\bof=/,
  /\bmkfs\b/,
  /\bgit\s+(?:clean\b|reset\s+--hard|checkout\s+--\s|restore\b|branch\s+-D|push\s+[^|;&]*--force)/,
  /\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree|Path\([^)]*\)\.unlink|fs\.(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)|File\.delete|FileUtils\.rm|rmtree)\b/,
  /\bperl\b[^|;&]*\bunlink\b/,
  /empty\s+(?:the\s+)?trash|secure\s+empty|\.Trash\b[^|;&]*(?:rm|delete)/i
];

// A shell command that would delete or destroy something: the reason, or '' when it is fine to ask the person about.
function shellBlocked(command) {
  const c = String(command || '');
  return DESTROYERS.some((re) => re.test(c)) ? NEVER_DELETE : '';
}

// An AppleScript that would empty the Trash or run a deleting command ("delete" in Finder only moves to the Trash, which stays possible).
function scriptBlocked(script) {
  const s = String(script || '');
  if (/empty\s+(?:the\s+)?trash|secure\s+empty/i.test(s)) return NEVER_DELETE;
  if (/do shell script/i.test(s) && DESTROYERS.some((re) => re.test(s))) return NEVER_DELETE;
  return '';
}

const TOP = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Public', 'Applications', 'Library'];

// Where Relay may move or trash things: inside your home folder, never the home folder or its main folders themselves, never Library,
// never hidden folders, never inside an app. Returns the reason it may not, or '' when it may.
function pathProblem(p, home) {
  if (typeof p !== 'string' || !p) return 'No path given.';
  const full = path.resolve(p.startsWith('~') ? path.join(home, p.slice(1)) : p);
  const rel = path.relative(home, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'That is outside your home folder, so Relay will not touch it.';
  if (rel === '') return 'That is your whole home folder.';
  const parts = rel.split(path.sep);
  if (parts.length === 1 && TOP.includes(parts[0])) return `That is your ${parts[0]} folder itself; pick something inside it.`;
  if (parts[0] === 'Library') return 'Library holds app data, so Relay leaves it alone.';
  if (parts.some((s) => s.startsWith('.'))) return 'That is a hidden file or folder, so Relay leaves it alone.';
  if (parts.some((s) => /\.(app|photoslibrary|musiclibrary|tvlibrary|imovielibrary|fcpbundle|logicx|band|xcodeproj|xcworkspace|framework|bundle|pkg|dmg)$/i.test(s))) return 'That is inside an app or a library package, so Relay leaves it alone.';
  return '';
}

module.exports = { NEVER_DELETE, shellBlocked, scriptBlocked, pathProblem };
