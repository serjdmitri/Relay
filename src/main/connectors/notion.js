// Notion, through an internal integration token you paste in Settings > Connectors. The integration only sees pages you share
// with it in Notion ("Add connections"). Plain REST with fetch; the tools are built from the API object so they can be tested.

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });

const plain = (rich = []) => rich.map((r) => r.plain_text || '').join('');
const titleOf = (page) => {
  const props = page.properties || {};
  for (const p of Object.values(props)) if (p.type === 'title') return plain(p.title) || 'Untitled';
  return plain(page.title) || 'Untitled'; // a database has its title on the object itself
};

// A block as one line of text.
function blockText(b) {
  const t = b.type;
  const v = b[t] || {};
  const text = plain(v.rich_text);
  switch (t) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `[${v.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return `> ${text}`;
    case 'code': return `\`\`\`\n${text}\n\`\`\``;
    case 'divider': return '---';
    case 'child_page': return `(sub-page: ${v.title})`;
    default: return text;
  }
}

// Text to blocks: one paragraph per line, "- " bullets, "# " headings. Notion allows 2000 characters in one rich text.
function textToBlocks(text) {
  const blocks = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let type = 'paragraph';
    let body = line;
    let m;
    if ((m = line.match(/^(#{1,3}) (.*)$/))) { type = `heading_${m[1].length}`; body = m[2]; }
    else if ((m = line.match(/^[-*] (.*)$/))) { type = 'bulleted_list_item'; body = m[1]; }
    for (let i = 0; i < body.length || i === 0; i += 1900) blocks.push({ object: 'block', type, [type]: { rich_text: [{ type: 'text', text: { content: body.slice(i, i + 1900) } }] } });
  }
  return blocks.slice(0, 100);
}

class NotionApi {
  constructor({ token, fetchImpl = fetch }) {
    this.token = token;
    this.fetch = fetchImpl;
  }

  async call(method, path, body) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'notion-version': VERSION, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 401) throw new Error('Notion rejected the token. Check it in Settings > Connectors.');
    if (res.status === 404) throw new Error('Notion cannot see that page. Open it in Notion, choose ••• > Connections, and add Relay.');
    if (res.status === 429) throw new Error('Notion says too many requests. Try again in a moment.');
    if (!res.ok) throw new Error(`Notion error ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  }

  async me() {
    const j = await this.call('GET', '/users/me');
    return { name: j.bot?.workspace_name || j.name || 'Notion' };
  }

  async search(query, limit = 10) {
    const j = await this.call('POST', '/search', { query: String(query || ''), page_size: Math.min(20, limit), sort: { direction: 'descending', timestamp: 'last_edited_time' } });
    return (j.results || []).map((r) => ({ id: r.id, type: r.object, title: titleOf(r), edited: (r.last_edited_time || '').slice(0, 10), url: r.url }));
  }

  async read(id) {
    const page = await this.call('GET', `/pages/${id}`).catch(async (e) => { if (/cannot see/.test(e.message)) throw e; return this.call('GET', `/databases/${id}`); });
    const kids = await this.call('GET', `/blocks/${id}/children?page_size=100`);
    const lines = (kids.results || []).map(blockText).filter(Boolean);
    return { title: titleOf(page), url: page.url, text: lines.join('\n'), more: !!kids.has_more };
  }

  // A new page under a page you shared (parent is its id).
  async create(parentId, title, text) {
    const j = await this.call('POST', '/pages', {
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: 'text', text: { content: String(title).slice(0, 200) } }] } },
      children: textToBlocks(text)
    });
    return { id: j.id, url: j.url };
  }

  async append(id, text) {
    await this.call('PATCH', `/blocks/${id}/children`, { children: textToBlocks(text) });
    return true;
  }
}

function notionTools(api) {
  return [
    {
      name: 'notion_search',
      description: 'Search the user\'s Notion pages and databases that were shared with Relay. Returns titles, ids and last edited dates, newest first. An empty query lists the recent ones.',
      input_schema: obj({ query: str('Words to look for') }),
      describe: (i) => `Searching Notion${i.query ? ` for ${i.query}` : ''}`,
      run: async (i) => JSON.stringify(await api.search(i.query))
    },
    {
      name: 'notion_read',
      description: 'Read a Notion page (its title and text) by id from notion_search.',
      input_schema: obj({ id: str('Page id') }, ['id']),
      describe: () => 'Reading a Notion page',
      run: async (i) => { const r = await api.read(i.id); return `${r.title}\n${r.url}\n\n${r.text}${r.more ? '\n[more below, not shown]' : ''}`; }
    },
    {
      name: 'notion_create',
      description: 'Create a new Notion page under a page the user shared with Relay (parent_id from notion_search). Text: one paragraph per line, "- " for bullets, "# " for headings.',
      input_schema: obj({ parent_id: str('Id of the page to create it under'), title: str('Page title'), text: str('Page text') }, ['parent_id', 'title']),
      describe: (i) => `Creating Notion page "${i.title}"`,
      run: async (i) => { const r = await api.create(i.parent_id, i.title, i.text); return `Created "${i.title}": ${r.url}`; }
    },
    {
      name: 'notion_append',
      description: 'Add text to the end of a Notion page (id from notion_search).',
      input_schema: obj({ id: str('Page id'), text: str('Text to add') }, ['id', 'text']),
      describe: () => 'Adding to a Notion page',
      run: async (i) => { await api.append(i.id, i.text); return 'Added.'; }
    }
  ];
}

module.exports = { NotionApi, notionTools, textToBlocks, blockText, titleOf };
