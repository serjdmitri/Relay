function parseLayout(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  let m = t.match(/^(?:save|remember) (?:this |my |the )?(?:panel )?layout(?: as (.+))?$/i);
  if (m) return { type: 'save', name: String(m[1] || 'My layout').trim().slice(0, 40) };
  m = t.match(/^(?:restore|open|load|bring back) (?:my |the )?(?:saved )?layout(?: (?:called|named) (.+))?$/i);
  if (m) return { type: 'open', name: String(m[1] || 'My layout').trim().slice(0, 40) };
  return null;
}
function findLayout(list, name) { return (list || []).find(x => String(x.name || '').toLowerCase() === String(name || '').toLowerCase()) || null; }
module.exports = { parseLayout, findLayout };
