// Merge bursts of notifications without delaying privacy checks at the caller.
function coalesce(run, schedule = setImmediate) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    schedule(() => { queued = false; run(); });
  };
}
module.exports = { coalesce };
