const { systemPreferences, shell } = require('electron');

const PANES = {
  accessibility: 'Privacy_Accessibility',
  screen: 'Privacy_ScreenCapture',
  input: 'Privacy_ListenEvent',
  mic: 'Privacy_Microphone',
  camera: 'Privacy_Camera',
  automation: 'Privacy_Automation',
  fulldisk: 'Privacy_AllFiles'
};
const SOUND_PANE = 'x-apple.systempreferences:com.apple.Sound-Settings.extension';

function status() {
  const trusted = systemPreferences.isTrustedAccessibilityClient?.(false) ?? false;
  const screen = (systemPreferences.getMediaAccessStatus?.('screen') ?? 'unknown') === 'granted';
  const micStatus = systemPreferences.getMediaAccessStatus?.('microphone') ?? 'unknown';
  const cameraStatus = systemPreferences.getMediaAccessStatus?.('camera') ?? 'unknown';
  return { accessibility: trusted, screen, mic: micStatus === 'granted', micStatus, camera: cameraStatus === 'granted', cameraStatus };
}

function requestAccessibility() {
  return systemPreferences.isTrustedAccessibilityClient?.(true) ?? false;
}

function openPane(name) {
  if (name === 'sound') return shell.openExternal(SOUND_PANE);
  const pane = PANES[name];
  if (!pane) return;
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

module.exports = { status, requestAccessibility, openPane };
