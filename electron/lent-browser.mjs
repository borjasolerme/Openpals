// A bot on a server this computer is lent to, browsing in the person's own Chrome here: main hands each browser call to
// this computer's own Openpals server (/api/desktop/lent-browser), where agent-browser runs attached to that Chrome.
// Nothing listens off this machine: the call came in through the lending loop's own outbound connection.

const CALL_TIMEOUT_MS = 130_000;
const CHECK = { name: "agent_browser_get_url", arguments: {} };

/** `url()`: that route on this computer's server; `headers()`: the desktop's own credentials for it. */
export function createLentBrowser({ fetch: fetchImpl = globalThis.fetch, url, headers = () => ({}), timeoutMs = CALL_TIMEOUT_MS }) {
  const call = async (key, method, params, signal) => {
    const response = await fetchImpl(url(), {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(method === "tools/call" ? { key, method, params } : { key, method }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof answer?.error === "string" ? answer.error : `This computer's Openpals answered ${response.status}`);
    return answer?.result;
  };
  return {
    call,
    /** Whether agent-browser reaches the person's Chrome now; the reason in plain words when it doesn't. */
    async check(signal) {
      try {
        const result = await call("check", "tools/call", CHECK, signal);
        if (result?.isError) return { ok: false, error: result?.content?.find?.(part => part?.type === "text")?.text ?? "Chrome didn't answer" };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },
  };
}

/** Opens the page in Chrome where the person allows it once: chrome:// pages open only in Chrome itself. */
export function chromeSetupCommand(platform = process.platform) {
  const page = "chrome://inspect/#remote-debugging";
  if (platform === "darwin") return { command: "open", args: ["-a", "Google Chrome", page] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", "chrome", page] };
  return { command: "google-chrome", args: [page] };
}
