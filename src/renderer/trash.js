relay.onTrash(state => {
  if (!state) return;
  document.documentElement.style.setProperty('--radius',`${state.radius}px`);
  document.getElementById('zone').classList.toggle('ready',state.inside);
  document.getElementById('hint').textContent=state.inside?'Release to dismiss':state.radius>120?'Drop here':'';
});
