// Deep research (idea from OpenJarvis's deep_research agent): "deep research on X" starts one of Relay's background agents with a research METHOD (several searches,
// the best pages actually opened, claims cross-checked, a Note with numbered sources), and when it finishes Relay CHECKS the citations: any link in the answer that the agent
// never actually opened or saw in a search result is called out, so a made-up source cannot slip through. Pure logic here; askController.js starts the agent.

const URL_RE = /https?:\/\/[^\s<>)\]}"'`]+/gi;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');
const norm = (u) => { try { const x = new URL(trimUrl(u)); x.hash = ''; return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`.toLowerCase(); } catch { return trimUrl(u).toLowerCase(); } };

// "deep research on X", "research X in depth", "do some deep research about X", "research X with sources|citations". Plain "research X" is left to everything else.
function parseResearchCommand(text) {
  const n = String(text || '').trim().replace(/[“”"]/g, '').replace(/^(?:hey |ok |okay )?(?:relay|jarvis)[, ]+/i, '').replace(/^please /i, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  let m = /^(?:(?:do|run|start|give me|make)(?: me)?(?: some| a)? )?deep(?:-| )research(?: (?:on|about|into|for|of))?:?\s+(.{3,300})$/i.exec(n);
  if (!m) m = /^(?:research|investigate|look into)\s+(.{3,300}?)\s+(?:in depth|in detail|thoroughly|with (?:sources|citations|references))$/i.exec(n);
  if (!m) m = /^(?:research|investigate)\s+(?:in depth|thoroughly):?\s+(.{3,300})$/i.exec(n);
  return m ? { type: 'research', topic: m[1].trim() } : null;
}

// The job given to the agent: the topic, then the method.
function buildTask(topic) {
  return `Deep research: ${String(topic).trim()}. Method: (1) write three to five focused search queries and run them; (2) open the five to eight most relevant and most trustworthy pages with fetch_page, preferring primary sources, and skip pages that look like ads or content farms; (3) note where sources agree and where they disagree, and treat a claim seen in only one place as uncertain; (4) write a Note titled "Research: ${String(topic).trim().slice(0, 60)}" with a short summary first, then the findings, each followed by a numbered source like [1], and a "Sources" list at the end giving each number's full address, only for pages you actually opened; (5) never invent a source, address or quote. Finish with a short spoken report: the main answer in two or three sentences, and how many sources you used.`;
}

// actions: the agent's recorded tool calls [{ tool, input, result, ok }]; text: its final answer.
// -> { cited: [url], unverified: [url], read: number }. A link counts as verified if the agent opened it (fetch_page / firefox_read_page) or saw it in a search result.
function verifyCitations(text, actions) {
  const acts = Array.isArray(actions) ? actions : [];
  const seen = new Set();
  for (const a of acts) {
    if (a.ok === false) continue;
    if (a.tool === 'fetch_page' || a.tool === 'firefox_open') { const u = a.input?.url; if (u) seen.add(norm(u)); }
    if (a.tool === 'web_search' || a.tool === 'fetch_page') for (const u of String(a.result ?? '').match(URL_RE) || []) seen.add(norm(u));
  }
  // what the agent wrote: its answer and any Note it saved
  const written = [String(text || ''), ...acts.filter((a) => a.tool === 'notes_create' || a.tool === 'notes_append').map((a) => `${a.input?.text || ''} ${a.input?.body || ''} ${a.input?.content || ''}`)].join('\n');
  const cited = [...new Set((written.match(URL_RE) || []).map(trimUrl))];
  const opened = new Set(acts.filter((a) => a.ok !== false && (a.tool === 'fetch_page' || a.tool === 'firefox_open')).map((a) => norm(a.input?.url || '')));
  // a cited link is fine if its page was opened or showed up in a search; the page's own address as a search hit is weaker, so "opened" is reported separately
  const unverified = cited.filter((u) => !seen.has(norm(u)));
  return { cited, unverified, read: opened.size };
}

// The paragraph added to a finished research agent's result, or '' when there is nothing to say.
function checkNote(v) {
  if (!v.cited.length) return '\n\nCheck: the answer cites no links, so I could not verify any sources.';
  if (!v.unverified.length) return `\n\nCheck: all ${v.cited.length} cited link${v.cited.length === 1 ? '' : 's'} were pages I opened or found in search results (${v.read} page${v.read === 1 ? '' : 's'} read in full).`;
  return `\n\nCheck: ${v.unverified.length} of ${v.cited.length} cited links were NOT among the pages I opened or found, so treat them as unverified: ${v.unverified.slice(0, 4).join(', ')}.`;
}

module.exports = { parseResearchCommand, buildTask, verifyCitations, checkNote };
