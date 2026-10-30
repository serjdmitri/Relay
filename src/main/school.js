// Read a user-selected school page only from an already open, signed-in Firefox tab.
// Page text is untrusted; callers must not treat it as instructions.
function schoolUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if ([...url.searchParams].some(([key, val]) => key.toLowerCase() !== 'svcid' || val.toLowerCase() !== 'edu')) return null;
    if (!url.hostname.toLowerCase().endsWith('.myschoolapp.com')) return null;
    if (!url.pathname.startsWith('/lms-assignment/assignment-center/')) return null;
    return url;
  } catch { return null; }
}

async function readSchoolPage(bridge, value) {
  const target = schoolUrl(value);
  if (!target) return { ok: false, reason: 'invalid-url' };
  if (!bridge?.isConnected()) return { ok: false, reason: 'browser-disconnected' };
  try {
    const tabs = await bridge.call('tabs.list', {});
    const match = (address) => {
      try {
        const url = new URL(address);
        return url.protocol === 'https:' && url.origin === target.origin && url.pathname === target.pathname;
      } catch { return false; }
    };
    const tab = (Array.isArray(tabs) ? tabs : []).find((t) => Number.isInteger(t.id) && match(t.url));
    if (!tab) return { ok: false, reason: 'tab-not-open' };
    const page = await bridge.call('page.read', { id: tab.id });
    if (!page || !match(page.url)) return { ok: false, reason: 'page-changed' };
    const text = typeof page.text === 'string' ? page.text.trim().slice(0, 12000) : '';
    if (!text || /\b(?:sign in|log in|session expired)\b/i.test(text) && text.length < 500) return { ok: false, reason: 'not-ready' };
    return { ok: true, text, truncated: text.length === 12000 };
  } catch { return { ok: false, reason: 'read-failed' }; }
}

module.exports = { schoolUrl, readSchoolPage };
