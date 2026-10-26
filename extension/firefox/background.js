// Persistent background page: keeps a WebSocket to the Relay app and executes its commands.
const PORT = 47831;
const VERSION = '0.2.0';
let ws = null;

function connect() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  } catch (e) {
    return setTimeout(connect, 3000);
  }
  ws.onopen = () => ws.send(JSON.stringify({ event: 'hello', version: VERSION }));
  ws.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    try {
      const result = await handle(msg.method, msg.params || {});
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, error: String((e && e.message) || e) }));
    }
  };
  ws.onclose = () => setTimeout(connect, 3000);
  ws.onerror = () => ws.close();
}

async function targetTab(id) {
  if (id != null) return browser.tabs.get(id);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) return tab;
  const [any] = await browser.tabs.query({ active: true });
  if (!any) throw new Error('No active tab.');
  return any;
}

const slim = (t) => ({ id: t.id, title: t.title, url: t.url, active: t.active, pinned: !!t.pinned, audible: !!t.audible, windowId: t.windowId });

async function inPage(tabId, code) {
  const [res] = await browser.tabs.executeScript(tabId, { code });
  return res;
}

// The tab whose title or URL best matches some words: every word must appear, and the active tab wins a tie.
async function findTab(match) {
  const words = String(match || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('Say which tab.');
  const scored = (await browser.tabs.query({}))
    .map((t) => {
      const hay = `${t.title || ''} ${t.url || ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const title = (t.title || '').toLowerCase();
      return { t, score: (title === words.join(' ') ? 100 : 0) + words.filter((w) => title.includes(w)).length * 5 + (t.active ? 1 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) throw new Error(`No tab matching "${match}".`);
  return scored[0].t;
}

// A new tab reports "complete" for its empty first page before it starts loading, so wait for the page that was asked for.
async function waitLoaded(tabId, ms = 8000, expectBlank = false) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await browser.tabs.get(tabId);
    if (t.status === 'complete' && (expectBlank || t.url !== 'about:blank')) return t;
    await new Promise((r) => setTimeout(r, 150));
  }
  return browser.tabs.get(tabId);
}

// Marks the clickable and typeable things on the page with numbers, and lists them. The numbers are what firefox_click and
// firefox_type use, which is steadier than guessing a selector. A new read renumbers everything.
const READ = `(() => {
  document.querySelectorAll('[data-relay-i]').forEach((e) => e.removeAttribute('data-relay-i'));
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || e.alt || e.name || e.id || '').trim().replace(/\\s+/g, ' ').slice(0, 70);
  const els = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=textbox],[contenteditable=""],[contenteditable=true],summary')].filter(vis).slice(0, 120);
  const elements = els.map((e, n) => {
    e.setAttribute('data-relay-i', String(n));
    const r = e.getBoundingClientRect();
    return { i: n, tag: e.tagName.toLowerCase(), type: e.type || e.getAttribute('role') || '', label: label(e), href: e.href && e.tagName === 'A' ? e.href.slice(0, 140) : undefined, inView: r.bottom > 0 && r.top < innerHeight };
  });
  return { title: document.title, url: location.href, text: (document.body && document.body.innerText || '').slice(0, 12000), scroll: { y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) }, elements };
})()`;

const FIND = (p) => `(() => {
  const idx = ${p.index == null ? 'null' : Number(p.index)};
  const sel = ${JSON.stringify(p.selector || '')};
  const text = ${JSON.stringify(String(p.text || '').toLowerCase())};
  let el = null;
  if (idx !== null) el = document.querySelector('[data-relay-i="' + idx + '"]');
  if (!el && sel) { try { el = document.querySelector(sel); } catch (e) {} }
  if (!el && text) {
    const all = [...document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button],[role=link],[role=tab],[role=menuitem],summary,label')];
    const t = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase();
    el = all.find((e) => t(e) === text) || all.find((e) => t(e).includes(text));
  }
  return el;
})()`;

async function handle(method, p) {
  switch (method) {
    case 'tabs.list':
      return (await browser.tabs.query({})).map(slim);

    case 'tabs.activate': {
      const tab = p.id != null ? await browser.tabs.get(p.id) : await findTab(p.match);
      await browser.windows.update(tab.windowId, { focused: true });
      await browser.tabs.update(tab.id, { active: true });
      return slim(await browser.tabs.get(tab.id));
    }

    case 'tabs.open': {
      let url = String(p.url || '');
      // A bare address gets https, except this machine and plain IP addresses, which have no certificate.
      if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(about|mailto|data|view-source):/i.test(url)) url = `${/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[::1\])(:|\/|$)/i.test(url) ? 'http' : 'https'}://${url}`;
      let tab = p.newTab === false ? await browser.tabs.update({ url }) : await browser.tabs.create({ url, active: p.background !== true });
      if (p.wait !== false) tab = await waitLoaded(tab.id, 8000, /^about:/.test(url));
      return slim(tab);
    }

    // Close by id, by several ids, by words in the title or URL (all matches), or every duplicate of a page (the first of each is kept).
    case 'tabs.close': {
      let ids = [];
      if (p.id != null) ids = [p.id];
      else if (Array.isArray(p.ids)) ids = p.ids;
      else if (p.duplicates) {
        const seen = new Set();
        for (const t of await browser.tabs.query({})) {
          const key = (t.url || '').replace(/#.*$/, '');
          if (seen.has(key) && !t.pinned) ids.push(t.id);
          seen.add(key);
        }
      } else if (p.match) {
        const words = String(p.match).toLowerCase().split(/\s+/).filter(Boolean);
        ids = (await browser.tabs.query({})).filter((t) => !t.pinned && words.every((w) => `${t.title || ''} ${t.url || ''}`.toLowerCase().includes(w))).map((t) => t.id);
      }
      if (!ids.length) throw new Error('No tabs to close.');
      if (ids.length > 25) throw new Error(`That would close ${ids.length} tabs; ask for fewer.`);
      await browser.tabs.remove(ids);
      return { closed: ids.length };
    }

    case 'tabs.reload': {
      const tab = await targetTab(p.id);
      await browser.tabs.reload(tab.id);
      return slim(await waitLoaded(tab.id));
    }

    case 'tabs.back':
    case 'tabs.forward': {
      const tab = await targetTab(p.id);
      await (method === 'tabs.back' ? browser.tabs.goBack(tab.id) : browser.tabs.goForward(tab.id));
      return slim(await waitLoaded(tab.id));
    }

    case 'page.read': {
      const tab = await targetTab(p.id);
      return inPage(tab.id, READ);
    }

    case 'page.click': {
      const tab = await targetTab(p.id);
      const res = await inPage(tab.id, `(() => {
        const el = ${FIND(p)};
        if (!el) return { ok: false, error: 'No matching element. Read the page again for fresh numbers.' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, clicked: (el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 60) };
      })()`);
      if (!res.ok) throw new Error(res.error);
      return res;
    }

    case 'page.type': {
      const tab = await targetTab(p.id);
      const res = await inPage(tab.id, `(() => {
        const el = ${FIND(p)};
        if (!el) return { ok: false, error: 'No matching field. Read the page again for fresh numbers.' };
        el.scrollIntoView({ block: 'center' });
        el.focus();
        const text = ${JSON.stringify(String(p.text ?? ''))};
        if (el.isContentEditable) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
        else {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && setter.set) setter.set.call(el, text); else el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (${!!p.submit}) {
          if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
          else for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
        return { ok: true };
      })()`);
      if (!res.ok) throw new Error(res.error);
      return res;
    }

    case 'page.press': {
      const tab = await targetTab(p.id);
      return inPage(tab.id, `(() => {
        const el = document.activeElement || document.body;
        const key = ${JSON.stringify(String(p.key || 'Enter'))};
        for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key, code: key, bubbles: true }));
        return { ok: true };
      })()`);
    }

    case 'page.scroll': {
      const tab = await targetTab(p.id);
      return inPage(tab.id, `(() => {
        const to = ${JSON.stringify(p.to ?? null)};
        if (to === 'top') scrollTo({ top: 0 });
        else if (to === 'bottom') scrollTo({ top: document.documentElement.scrollHeight });
        else if (typeof to === 'number') scrollTo({ top: to });
        else scrollBy({ top: ${p.direction === 'up' ? -1 : 1} * (${Number(p.amount) || 0} || innerHeight * 0.85) });
        return { y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) };
      })()`);
    }

    // A picture of the visible part of a tab (the tab is brought forward first).
    case 'page.screenshot': {
      const tab = await targetTab(p.id);
      if (!tab.active) { await browser.tabs.update(tab.id, { active: true }); await new Promise((r) => setTimeout(r, 250)); }
      const url = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      return { mediaType: 'image/jpeg', data: url.replace(/^data:image\/jpeg;base64,/, '') };
    }

    default:
      throw new Error(`Unknown method ${method}`);
  }
}

connect();
