const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestSkill } = require('../src/main/skillSuggestions');
test('repeated safe requests are proposed for review, not executed', () => {
  const history = [{ text: 'open notes', status: 'done' }];
  assert.deepEqual(suggestSkill('open notes', [{ tool: 'open_app' }], history, []), { name: 'open notes', steps: ['open notes'] });
  assert.equal(suggestSkill('open notes', [{ tool: 'messages_send' }], history, []), null);
  assert.equal(suggestSkill('open notes', [{ tool: 'open_app' }], [], []), null);
  assert.equal(suggestSkill('open notes', [{ tool: 'open_app' }], history, [{ name: 'open notes' }]), null);
});
