// One model presents three distinct perspectives; it is not three independent agents.
function parseDebate(text) {
  const m = String(text || '').trim().match(/^(?:have (?:a |the )?(?:three.persona )?debate (?:about |on )?|(?:three.persona )?debate (?:about |on )?)(.+)$/i);
  return m ? m[1].trim() : null;
}
function debatePrompt(topic) {
  return `Discuss this request as three perspectives from one assistant: Creative (possibilities), Skeptic (risks and objections), and Practical (constraints and next steps). Give each a brief position, let them respond to the main disagreement, then provide a balanced recommendation. Be clear these are simulated perspectives, not separate agents. The user's topic is: ${topic}`;
}
module.exports = { parseDebate, debatePrompt };
