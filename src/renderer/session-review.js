/* global h, esc, relay */
// Review facts: pick lines out of a session's notes. Nothing is saved or exported until a button is pressed, and only the ticked lines, as edited, are used.
async function reviewCall(action, value) { const r = await relay.sessionReview(action, value); if (r && r.error && !r.rejected) throw Error(r.error); return r || {}; }

function openSessionReview(session, row, notice, redraw) {
  const old = row.querySelector('[data-review]');
  if (old) { old.remove(); return; }
  const panel = h('<div data-review class="card" style="padding:12px;margin-top:12px"><div class="ttl">Review facts</div><p class="d" style="margin:6px 0">Tick the lines worth keeping and fix the wording if you like. Nothing is saved until you press a button, and only the ticked lines are used. Lines marked <b>Relay replied</b> are the model\'s own words and may be wrong, so check them first. Anything that looks like a password or key is never offered.</p><div data-review-list class="d">Looking through the notes…</div><div data-review-actions style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" hidden><button class="btn primary" data-review-save>Save ticked as memories</button><button class="btn" data-review-export>Export ticked to a file</button></div><div style="margin-top:8px"><button class="btn" data-review-close>Close</button></div></div>');
  row.append(panel);
  const list = panel.querySelector('[data-review-list]'), actions = panel.querySelector('[data-review-actions]'), rows = [];
  panel.querySelector('[data-review-close]').onclick = () => panel.remove();
  const picks = () => rows.filter((x) => x.box.checked).map((x) => ({ entryId: x.s.entryId, text: x.input.value }));
  const run = (name) => async () => {
    const chosen = picks();
    if (!chosen.length) { notice('Tick at least one line first.'); return; }
    try {
      const r = await reviewCall(name, { id: session.id, picks: chosen });
      if (r.error) { notice(`${r.error}${r.rejected && r.rejected.length > 1 ? ` (${r.rejected.length} lines were not accepted)` : ''}`); return; }
      if (name === 'export') notice(`Local file created: ${r.file}. It holds only the ${r.count} line${r.count === 1 ? '' : 's'} you ticked.`);
      else notice(`Saved ${r.added.length} memor${r.added.length === 1 ? 'y' : 'ies'}.${r.skipped.length ? ` Skipped ${r.skipped.length} (${[...new Set(r.skipped.map((x) => x.why))].join(' ')})` : ''}${r.rejected && r.rejected.length ? ` ${r.rejected.length} not accepted.` : ''}${r.exportFailed ? ` ${r.exportFailed} saved in Relay, but their import files could not be created in Desktop/memory.` : ''}`);
      if (name === 'save' && typeof redraw === 'function') redraw();
    } catch (e) { notice(e.message); }
  };
  panel.querySelector('[data-review-save]').onclick = run('save');
  panel.querySelector('[data-review-export]').onclick = run('export');
  reviewCall('suggest', { id: session.id }).then((r) => {
    if (!panel.isConnected) return;
    list.replaceChildren();
    if (!r.suggestions || !r.suggestions.length) { list.textContent = 'No lines in this session look like facts worth keeping. You can still keep a note by exporting the whole session.'; return; }
    for (const s of r.suggestions) {
      const item = h(`<label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0"><input type="checkbox" data-pick style="margin-top:6px"><div style="flex:1"><div class="d">${s.source === 'you' ? 'You said' : '<b>Relay replied</b> (not verified)'}${s.context && s.source === 'relay' ? ` · to: “${esc(s.context)}”` : ''}</div><input class="field" data-text maxlength="240" aria-label="Fact to keep" style="width:100%"></div></label>`);
      const input = item.querySelector('[data-text]'); input.value = s.text;
      rows.push({ s, box: item.querySelector('[data-pick]'), input });
      list.append(item);
    }
    actions.hidden = false;
  }).catch((e) => { list.textContent = e.message; });
}
