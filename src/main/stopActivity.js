// Best-effort cancellation: failures in one subsystem must not block the others.
function stopActivity({ask, hands, motion, overlay} = {}) {
  const failed = [];
  const run = (name, fn) => { try { fn(); } catch { failed.push(name); } };
  run('request', () => ask?.stop());
  run('agents', () => ask?.agents?.stop());
  run('speech', () => ask?.speaker?.stop());
  run('listening', () => ask?.speech?.cancel());
  run('hands', () => { if (hands?.enabled && !hands.paused) hands.setPaused(true); });
  run('motion', () => motion?.stop());
  run('overlay', () => overlay?.releaseInput());
  run('prompt', () => ask?.cancelAll());
  return { ok: failed.length === 0, failed };
}
module.exports = { stopActivity };
