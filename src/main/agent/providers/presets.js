// Services that speak the OpenAI chat completions format (tools, image_url). One provider class covers all of them.
// The model is an editable default: model names change, so the Test button in Account is the check.
const PRESETS = {
  openai: { label: 'OpenAI (ChatGPT API)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys', vision: true },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/apikey', vision: true },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', vision: false },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', vision: false },
  xai: { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', keyUrl: 'https://console.x.ai', vision: false },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', vision: false },
  custom: { label: 'Custom address', baseUrl: '', model: '', keyUrl: '', vision: false, keyOptional: true }
};

const isPreset = (id) => Object.prototype.hasOwnProperty.call(PRESETS, id);

module.exports = { PRESETS, isPreset };
