const { systemPreferences, shell } = require('electron');

const PANES = {
  accessibility: 'Privacy_Accessibility',
  screen: 'Privacy_ScreenCapture',
  input: 'Privacy_ListenEvent',
  automation: 'Privacy_Automation'
};

function status() {
  const trusted = systemPreferences.isTrustedAccessibilityClient?.(false) ?? false;
  const screen = (systemPreferences.getMediaAccessStatus?.('screen') ?? 'unknown') === 'granted';
  return { accessibility: trusted, screen };
}

function requestAccessibility() {
  return systemPreferences.isTrustedAccessibilityClient?.(true) ?? false;
}

function openPane(name) {
  const pane = PANES[name];
  if (!pane) return;
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

module.exports = { status, requestAccessibility, openPane };
