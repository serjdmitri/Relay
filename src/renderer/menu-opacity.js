// Shared across floating menus; opacity affects the surface, never the text.
const syncMenuOpacity = async () => {
  try { const state = await relay.getState(); const value = Number(state.settings?.menuOpacity ?? .88); document.documentElement.style.setProperty('--menu-opacity', String(Math.max(.55, Math.min(1, Number.isFinite(value) ? value : .88)))); } catch {}
};
syncMenuOpacity();
relay.onStateChanged(syncMenuOpacity);
