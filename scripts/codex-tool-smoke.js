// Opt-in integration check: one harmless local tool call through the real Codex CLI.
// Uses the signed-in account and consumes model usage. It does not control apps or files.
const { McpHost } = require('../src/main/agent/claudeCli');
const { findCodex, codexStatus, runCodex } = require('../src/main/agent/codexCli');

async function main() {
  const codexPath = await findCodex();
  const status = await codexStatus(codexPath);
  if (!status.usable) throw new Error('Sign in to Codex with ChatGPT before running this check.');
  const host = new McpHost();
  await host.start();
  let called = 0;
  const code = 'relay-probe-419';
  try {
    const result = await runCodex({
      codexPath, host, timeoutMs: 60000,
      text: 'Call the relay diagnostic_probe tool and report the code it returns.',
      tools: [{ name: 'diagnostic_probe', description: 'Returns the diagnostic code; call this tool to retrieve it.', input_schema: { type: 'object', properties: {}, additionalProperties: false }, run: async () => { called++; return code; } }]
    });
    if (result.status !== 'done' || called !== 1 || !result.reply.includes(code)) throw new Error(`Tool check failed (status: ${result.status}, calls: ${called}): ${result.reply}`);
    console.log('Codex reached the Relay tool host and returned its code.');
  } finally { host.stop(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
