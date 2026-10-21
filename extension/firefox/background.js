// Persistent background page: keeps a WebSocket to the Relay app and executes its commands.
const PORT = 47831;
let ws = null;

function connect() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  } catch (e) {
    return setTimeout(connect, 3000);
  }
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
  if (!tab) throw new Error('No active tab.');
  return tab;
}

const slim = (t) => ({ id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId });

async function inPage(tabId, code) {
  const [res] = await browser.tabs.executeScript(tabId, { code });
  return res;
}

async function handle(method, p) {
  switch (method) {
    case 'tabs.list':
      return (await browser.tabs.query({})).map(slim);

    case 'tabs.activate': {
      let tab;
      if (p.id != null) tab = await browser.tabs.get(p.id);
      else {
        const m = String(p.match || '').toLowerCase();
        tab = (await browser.tabs.query({})).find((t) => (t.title || '').toLowerCase().includes(m) || (t.url || '').toLowerCase().includes(m));
        if (!tab) throw new Error(`No tab matching "${p.match}".`);
      }
      await browser.windows.update(tab.windowId, { focused: true });
      await browser.tabs.update(tab.id, { active: true });
      return slim(tab);
    }

    case 'tabs.open': {
      const tab = p.newTab === false ? await browser.tabs.update({ url: p.url }) : await browser.tabs.create({ url: p.url });
      return slim(tab);
    }

    case 'tabs.close':
      await browser.tabs.remove(p.id);
      return { closed: p.id };

    case 'page.read': {
      const tab = await targetTab(p.id);
      const data = await inPage(tab.id, `(() => {
        const txt = (document.body && document.body.innerText || '').slice(0, 12000);
        const links = [...document.querySelectorAll('a[href]')].slice(0, 40).map(a => (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80) + ' -> ' + a.href).filter(s => s.indexOf(' -> ') > 0);
        const fields = [...document.querySelectorAll('input,textarea,select,button')].slice(0, 40).map(e => ({ tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || e.id || '', label: (e.getAttribute('aria-label') || e.placeholder || e.innerText || '').trim().slice(0, 60) }));
        return { title: document.title, url: location.href, text: txt, links, fields };
      })()`);
      return data;
    }

    case 'page.click': {
      const tab = await targetTab(p.id);
      const res = await inPage(tab.id, `(() => {
        const sel = ${JSON.stringify(p.selector || '')};
        const text = ${JSON.stringify((p.text || '').toLowerCase())};
        let el = null;
        if (sel) el = document.querySelector(sel);
        if (!el && text) {
          const all = [...document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button],[role=link],summary,label')];
          el = all.find(e => ((e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase()) === text)
            || all.find(e => ((e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase()).includes(text));
        }
        if (!el) return { ok: false, error: 'No matching element.' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true, clicked: (el.innerText || el.value || el.tagName).slice(0, 60) };
      })()`);
      if (!res.ok) throw new Error(res.error);
      return res;
    }

    case 'page.type': {
      const tab = await targetTab(p.id);
      const res = await inPage(tab.id, `(() => {
        const el = document.querySelector(${JSON.stringify(p.selector)});
        if (!el) return { ok: false, error: 'No element for that selector.' };
        el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(el, ${JSON.stringify(p.text)}); else el.value = ${JSON.stringify(p.text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (${!!p.submit}) {
          if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
        return { ok: true };
      })()`);
      if (!res.ok) throw new Error(res.error);
      return res;
    }

    default:
      throw new Error(`Unknown method ${method}`);
  }
}

connect();
