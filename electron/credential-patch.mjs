// What saving a credential from the desktop changes in the server config, by credential name.
export const CREDENTIAL_PATCH = {
  openaiApiKey: (value) => ({ openai: { key: value } }),
  // everyClaudeBot travels with the key, so no moment exists where a first key moves every signed-in Claude bot onto API billing.
  anthropicApiKey: (value, options) => ({ anthropic: { key: value, ...(options?.everyClaudeBot === false ? { everyClaudeBot: false } : {}) } }),
  openrouterApiKey: (value) => ({ openrouter: { key: value } }),
  mistralApiKey: (value) => ({ mistral: { key: value } }),
  cerebrasApiKey: (value) => ({ cerebras: { key: value } }),
  groqApiKey: (value) => ({ groq: { key: value } }),
  greenferenceApiKey: (value) => ({ greenference: { key: value } }),
  metaApiKey: (value) => ({ meta: { key: value } }),
  deepseekApiKey: (value) => ({ deepseek: { key: value } }),
  openaiCompatApiKey: (value) => ({ openaiCompat: { key: value } }),
  composioApiKey: (value) => ({ composio: { apiKey: value } }),
  xaiApiKey: (value) => ({ xai: { key: value } }),
  boxToken: (value) => ({ box: { token: value } }),
  opencodeGoApiKey: (value) => ({ opencodeGo: { apiKey: value } }),
  ttsKey: (value) => ({ tts: { key: value } }),
  fishAudioKey: (value) => ({ tts: { fishKey: value } }),
  jevApiKey: (value) => ({ decider: { key: value } }),
  openrouterDeciderKey: (value) => ({ decider: { openrouterKey: value } }),
  workersAiToken: (value) => ({ decider: { workersAiToken: value } }),
  openaiImageApiKey: (value) => ({ imageGen: { key: value } }),
  customImageApiKey: (value) => ({ imageGen: { customApiKey: value } }),
  openaiLiveKey: (value) => ({ live: { key: value } }),
  tregApiKey: (value) => ({ treg: { key: value } }),
  postizApiKey: (value) => ({ postiz: { key: value } }),
};

/** Electron 43's ipcMain.handle sends a thrown error to the page as its toString(), so a key the provider refused travels as its name. */
export function credentialSaveError(status, body) {
  const error = new Error(body?.error || `Could not save credential (HTTP ${status})`);
  if (body?.code === "key_rejected") error.name = "KeyRejected";
  return error;
}
