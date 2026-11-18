/** The longest an engine waits on one agents tool call, its result included. Codex CLI otherwise ends an MCP tool call
 * after the server's tool_timeout_sec, 60 by default in its config docs. */
export const AGENTS_TOOL_TIMEOUT_SECONDS = 360;
