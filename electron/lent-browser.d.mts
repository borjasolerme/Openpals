export function createLentBrowser(options: {
  fetch?: typeof fetch;
  url: () => string;
  headers?: () => Record<string, string>;
  timeoutMs?: number;
}): {
  call(key: string, method: "tools/list" | "tools/call", params: unknown, signal?: AbortSignal): Promise<unknown>;
  check(signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }>;
};
export function chromeSetupCommand(platform?: NodeJS.Platform): { command: string; args: string[] };
