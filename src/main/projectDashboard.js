// A local activity view, not an AI-generated assessment of project progress.
const PROJECTS = [
  { name: 'Relay', match: /\b(?:relay|jarvis)\b/i },
  { name: 'Robotics', match: /\b(?:robotics|robot|vex|arduino)\b/i },
  { name: 'Schoolwork', match: /\b(?:school|homework|assignment|classwork)\b/i }
];
const clean = (s, n = 100) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const topic = s => String(s || '').replace(/^(?:(?:hey|ok|okay)\s+)?(?:jarvis|relay)[, ]+/i, '');
function isProjectDashboard(text) {
  return /^(?:(?:hey|ok|okay)\s+)?(?:(?:jarvis|relay)[, ]+)?(?:please\s+)?(?:(?:show|open|display)(?: me)? (?:my |the )?)?projects? (?:dashboard|board|overview)[.!?]*$/i.test(String(text || '').trim());
}
function projectCard(history = [], tasks = []) {
  return { kind: 'list', hold: true, title: 'Project dashboard', subtitle: 'Based on matching Relay requests on this Mac', summary: 'Recent activity and queued requests. A completed request is not proof that a whole project is complete.', facts: [], links: [], image: null, credit: '', items: PROJECTS.map(p => {
    const recent = history.find(h => ['done', 'failed', 'stopped'].includes(h.status) && p.match.test(topic(h.text)) && !isProjectDashboard(h.text));
    const next = tasks.find(t => t.status === 'queued' && p.match.test(topic(t.text)));
    return { title: p.name, subtitle: recent ? `Last request ${recent.status}: ${clean(recent.text)}` : 'No matching completed request recorded', note: next ? `Queued: ${clean(next.text)}` : 'No matching request queued', image: null, url: '' };
  }) };
}
module.exports = { isProjectDashboard, projectCard };
