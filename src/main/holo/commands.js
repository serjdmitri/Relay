// Spoken commands about the hologram library and scenes. Pure.

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const { lengthToMm } = require('../calc');
const strip = (s) => clean(s).replace(/^(?:my|the|a|an) /, '').replace(/ (?:scene|setup)$/, '').trim();

function parseHoloCommand(text) {
  const n = clean(text).replace(/^(?:hey |ok |okay )?(?:relay|jarvis) /, '').replace(/^please /, '').replace(/ please$/, '');
  let m;
  // life size: "show it life size", "real size", "actual size, it is 30 cm long"
  if ((m = n.match(/^(?:show|make|put|display|set)(?: it| that| this| the hologram| the model)?(?: at| in| to)? (?:real|life|actual|true|full)[ -]?size(?:,? (?:it is|its|it s|its about|it is about|about|which is) (.+))?$/)) || (m = n.match(/^(?:real|life|actual|true)[ -]?size(?:,? (?:it is|its|it s|about) (.+))?$/))) {
    const mm = m[1] ? lengthToMm(m[1]) : 0;
    if (!m[1] || mm) return { type: 'holo-realsize', mm: mm || 0 };
  }
  // scenes (the word "scene" is required, so "save this as stl" is never taken for one)
  if ((m = n.match(/^(?:save|remember|store|keep)(?: this| these| the current| my current| all these| the)?(?: holograms?)? scene as (?:my |the |a )?(.+)$/)) || (m = n.match(/^(?:save|remember|store|keep) (?:these|this|the|my) holograms? as (?:my |the |a )?(.+?) scene$/)) || (m = n.match(/^(?:save|remember|store|keep) (?:a |the |this )?scene (?:called |named |as )?(.+)$/))) {
    const name = strip(m[1]);
    if (name) return { type: 'scene-save', name };
  }
  if (/^(?:list|show|what|which)(?: me)?(?: are)?(?: all)?(?: of)?(?: my)? (?:saved )?scenes(?: do i have| i have| i saved)?$/.test(n) || /^what scenes do i have$/.test(n)) return { type: 'scene-list' };
  if ((m = n.match(/^(?:delete|forget|remove|drop) (?:my |the )?(.+?) scene$/))) return { type: 'scene-delete', name: strip(m[1]) };
  if ((m = n.match(/^(?:show|open|bring back|load|restore|set up|go to|switch to|bring up|put up|start) (?:my |the )?(.+?) scene$/))) {
    const name = strip(m[1]);
    if (name) return { type: 'scene-open', name };
  }
  // the library
  if (/^(?:show|open|list|see|pull up|bring up)(?: me)?(?: all)?(?: of)?(?: my)? (?:saved |recent |old )?(?:holograms|hologram library|library of holograms|hologram history)(?: i (?:made|have|saved|have made|ve made))?$/.test(n) || /^(?:my |the )?hologram library$/.test(n) || /^what holograms (?:have i|did i|do i have)(?: made| saved| have| make)?$/.test(n)) return { type: 'holo-library' };
  if ((m = n.match(/^(?:find|search|look for|search for|search my|look up)(?: my| the| a)? holograms?(?: library)? (?:for|of|about|with)? ?(.+)$/)) || (m = n.match(/^(?:find|look for|search for) (?:my |the )?(.+?) hologram$/))) {
    const q = clean(m[1]).trim();
    if (q) return { type: 'holo-find', query: q };
  }
  if ((m = n.match(/^(?:bring back|reopen|open|show me|show|pull up|load|get) (?:my |the )?(.+?) hologram(?: again| back)?$/))) {
    const q = clean(m[1]).trim();
    if (q && !/^(?:a|an|new|3d|that|this|every|all|last)$/.test(q)) return { type: 'holo-open', query: q };
  }
  return null;
}

module.exports = { parseHoloCommand };
