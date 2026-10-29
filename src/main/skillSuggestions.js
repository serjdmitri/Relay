// A suggestion is only a request to review a routine. It never runs by itself.
const SAFE = new Set(['open_app', 'focus_app', 'open_url', 'open_path', 'arrange_window', 'set_volume', 'toggle_dark_mode']);
function suggestSkill(text, steps, history, suggestions) {
  const title = String(text || '').trim();
  if (title.length < 4 || title.length > 100 || !steps?.length || steps.some(s => !SAFE.has(s.tool))) return null;
  const same = h => String(h.text || '').trim().toLowerCase() === title.toLowerCase();
  if (!(history || []).some(h => h.status === 'done' && same(h))) return null;
  if ((suggestions || []).some(s => s.name.toLowerCase() === title.toLowerCase())) return null;
  return { name: title, steps: [title] };
}
module.exports = { suggestSkill };
