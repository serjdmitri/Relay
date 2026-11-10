// Edit only standalone numeric parameter assignments; never interpret OpenSCAD code.
const MAX_BYTES = 1024 * 1024;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function editParameter(source, name, value) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) throw Error('OpenSCAD file is too large or invalid.');
  if (!IDENTIFIER.test(name)) throw Error('Choose a valid parameter name.');
  const literal = String(value);
  if (!NUMBER.test(literal) || !Number.isFinite(Number(literal)) || Math.abs(Number(literal)) > 1000000) throw Error('Choose a finite numeric value within one million.');
  // Ignore lines in block comments, including comments spanning several lines.
  let inComment = false, count = 0;
  const lines = source.split(/(?<=\n)/);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*${escaped}\\s*=\\s*)([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)(\\s*;\\s*(?://[^\\r\\n]*)?)(\\r?\\n)?$`);
  const out = lines.map(line => {
    const beganInComment = inComment;
    let string = false, slash = false;
    for (let i = 0; i < line.length; i++) {
      const pair = line.slice(i, i + 2);
      if (inComment) { if (pair === '*/') { inComment = false; i++; } continue; }
      if (!string && pair === '//') break;
      if (!string && pair === '/*') { inComment = true; i++; continue; }
      if (line[i] === '"' && !slash) string = !string;
      slash = line[i] === '\\' && !slash;
    }
    if (beganInComment) return line;
    return line.replace(pattern, (_all, prefix, _old, suffix, newline = '') => { count++; return prefix + literal + suffix + newline; });
  });
  if (count !== 1) throw Error(count ? 'Parameter appears more than once; no change was made.' : 'No standalone numeric parameter was found; no change was made.');
  return out.join('');
}
module.exports = { editParameter, MAX_BYTES };
