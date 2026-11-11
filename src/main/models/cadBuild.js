// Reveal normalized CAD shapes in order. Stop if the hologram is closed or edited.
async function revealCad({ cad, initial, show, update, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), delay = 1500 }) {
  const shapes = cad.shapes;
  const start = shapes.findIndex(shape => !shape.hole) + 1;
  let previous = { shapes: shapes.slice(0, start) };
  const id = await show(previous, initial(start));
  for (let count = start + 1; count <= shapes.length; count++) {
    await wait(delay);
    const next = { shapes: shapes.slice(0, count) };
    if (!update(id, previous, next, initial(count))) return { id, completed: false, count: count - 1 };
    previous = next;
  }
  return { id, completed: true, count: shapes.length };
}
module.exports = { revealCad };
