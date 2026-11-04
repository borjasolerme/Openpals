import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, MoreHorizontal } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { reserveConnectionPage } from "@/lib/connector-oauth";
import { completeMcpSignIn, mcpSignInLink, runMcpSignIn, type McpSignInStatus } from "@/lib/mcp-sign-in";
import { POSTIZ_API, postizErrorText, postizHost, postizSaveErrorText } from "@/lib/postiz";
import { isPostizStatus, POSTIZ_CLOUD, POSTIZ_KEY_PAGE, POSTIZ_SERVER, type PostizStatus } from "../../shared/postiz";
import { cleanKey, looksLikeKey, saveCredential } from "./keys/key-save";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";

const pill = "inline-flex h-7 min-w-[64px] shrink-0 items-center justify-center gap-2 rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink transition-colors hover:bg-raised-hover disabled:opacity-40";
const field = "h-8 w-full min-w-0 rounded-lg bg-inset px-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-accent/50";
const link = "text-[12px] text-accent-text underline underline-offset-2";
const SERVER = encodeURIComponent(POSTIZ_SERVER);

/** OpenMausBot's own mark for Postiz: no Postiz artwork is bundled. */
export function PostizIcon() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 rounded-[10px]" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#612bd3" />
      <path d="M14 29V11h7.2c4.1 0 6.8 2.3 6.8 5.9s-2.7 5.9-6.8 5.9h-3.1V29zm4.1-9.7h2.8c1.9 0 3-0.9 3-2.4s-1.1-2.4-3-2.4h-2.8z" fill="#fff" fillRule="evenodd" />
    </svg>
  );
}

/** The Postiz card in Apps: Postiz Cloud's sign-in, or an organisation API key for Postiz Cloud or the person's own
 * Postiz server. Once connected, bots get Postiz's tools as the `postiz` MCP server. */
export function PostizCard({ refreshKey = 0, onConnection }: {
  refreshKey?: number;
  /** true once connected, false otherwise, null until the server has answered */
  onConnection?: (connected: boolean | null) => void;
}) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<PostizStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"sign-in" | "key" | "disconnect" | null>(null);
  const [flow, setFlow] = useState<McpSignInStatus | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [keyMode, setKeyMode] = useState(false);
  const [key, setKey] = useState("");
  const [address, setAddress] = useState("");
  const mounted = useRef(true);
  const signIn = useRef<{ controller: AbortController; complete?: (result: McpSignInStatus) => void } | null>(null);

  const load = useCallback(async (check = false): Promise<PostizStatus | null> => {
    try {
      const response = await api(check ? `${POSTIZ_API}/check` : POSTIZ_API, check ? { method: "POST" } : undefined);
      if (!mounted.current) return null;
      if (!isPostizStatus(response)) throw new Error("unexpected Postiz status");
      setStatus(response);
      setLoadFailed(false);
      return response;
    } catch (cause) {
      if (!mounted.current) return null;
      if ((cause as { status?: number }).status === 403) setHidden(true);
      else setLoadFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load().then((loaded) => {
      // A sign-in or key revoked in Postiz shows as such: the server checks again at most every few minutes.
      if (loaded?.state === "connected") void load(true);
    });
    return () => {
      mounted.current = false;
      signIn.current?.controller.abort();
      signIn.current = null;
    };
  }, [load, refreshKey]);

  const connected = status?.state === "connected";
  useEffect(() => {
    onConnection?.(status ? connected : null);
  }, [status, connected, onConnection]);

  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });

  const connect = async () => {
    if (busy || signIn.current) return;
    // Reserve the tab during the click, before a request uses up the browser's user activation.
    const launch = reserveConnectionPage();
    const controller = new AbortController();
    signIn.current = { controller };
    setBusy("sign-in");
    setError(null);
    setCallbackUrl("");
    const open = async (url: string) => { const opened = await launch.open(url); launch.cancel(); return opened; };
    try {
      await api(`${POSTIZ_API}/sign-in`, { method: "POST" });
      const result = await runMcpSignIn(POSTIZ_SERVER, {
        api, signal: controller.signal,
        open: async (url) => { if (!await open(url) && mounted.current && !controller.signal.aborted) setError(t("connectors.popupBlockedContinue")); },
        onStarted: (started, complete) => { if (signIn.current?.controller === controller) signIn.current.complete = complete; if (mounted.current) setFlow(started); },
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (result.phase !== "succeeded") {
        if (result.phase !== "cancelled") setError(result.message || t("mcp.auth.failed"));
        return;
      }
      setLoadingTools(true);
      const tested = await api(`/api/mcp/servers/${SERVER}/test`, { method: "POST", signal: controller.signal }) as { ok: boolean; error?: string };
      if (!tested.ok) {
        const reason = (tested.error ?? "").trim();
        setError(t("postiz.error.testFailed", { reason: reason && !/[.!?]$/u.test(reason) ? `${reason}.` : reason }));
        return;
      }
      await api(`/api/mcp/servers/${SERVER}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(postizErrorText(cause, POSTIZ_CLOUD));
    } finally {
      launch.cancel();
      if (signIn.current?.controller === controller) signIn.current = null;
      if (mounted.current) {
        setFlow(null);
        setLoadingTools(false);
        setBusy(null);
        await load();
      }
    }
  };

  const completePasted = async () => {
    const current = signIn.current;
    if (!current || !flow?.flowId || !callbackUrl.trim()) return;
    try {
      current.complete?.(await completeMcpSignIn(POSTIZ_SERVER, flow.flowId, callbackUrl, api));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const connectWithKey = async () => {
    const value = cleanKey(key);
    const target = address.trim();
    if (busy) return;
    if (!looksLikeKey(value)) return setError(t("keys.notAKey"));
    setBusy("key");
    setError(null);
    try {
      await api(`${POSTIZ_API}/key-check`, { method: "POST", body: JSON.stringify({ key: value, ...(target ? { address: target } : {}) }) });
      const saved = state.config?.postiz?.url ?? "";
      const wanted = target && postizHost(target) !== postizHost(POSTIZ_CLOUD) ? target : "";
      if (wanted !== saved) applied(await api("/api/config", { method: "PUT", body: JSON.stringify({ postiz: { url: wanted } }) }));
      applied(await saveCredential("postiz", value, state.config?.postiz?.configured !== true));
      if (!mounted.current) return;
      setKey("");
      setKeyMode(false);
    } catch (cause) {
      if (mounted.current) setError(postizSaveErrorText(cause, target || POSTIZ_CLOUD));
    } finally {
      if (mounted.current) {
        setBusy(null);
        await load();
      }
    }
  };

  const disconnect = async () => {
    if (busy || !window.confirm(t("postiz.disconnectConfirm"))) return;
    setBusy("disconnect");
    setError(null);
    try {
      if (status?.keySaved) applied(await saveCredential("postiz", "", false));
      await api(POSTIZ_API, { method: "DELETE" });
    } catch (cause) {
      if (mounted.current) setError(postizErrorText(cause, status?.address ?? POSTIZ_CLOUD));
    } finally {
      if (mounted.current) {
        setBusy(null);
        await load();
      }
    }
  };

  const cancel = () => signIn.current?.controller.abort();

  if (hidden) return null;
  const waiting = busy === "sign-in";
  const needsSignIn = status?.state === "needs-sign-in";
  const refused = status?.state === "key-refused";
  const taken = status?.state === "taken";
  const description = taken ? t("postiz.taken")
    : connected
      ? status?.how === "key" ? t("postiz.connectedKey", { host: status.host }) : t("postiz.connectedTo", { host: status?.host ?? "" })
      : needsSignIn ? t("connectors.signedOut")
        : refused ? t("postiz.keyRefused")
          : t("postiz.description");
  const menu = (connected || needsSignIn || refused) && (
    <SidebarPopoverMenu
      placement="below"
      ariaLabel={t("postiz.menu")}
      triggerClassName="shrink-0"
      items={[{ key: "disconnect", label: t("connectors.disconnect"), disabled: busy !== null, onSelect: () => void disconnect() }]}
      renderTrigger={() => (
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-control/80 text-ink hover:bg-raised-hover">
          {busy === "disconnect" ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={15} aria-hidden="true" />}
        </span>
      )}
    />
  );
  const offerConnect = status !== null && !connected && !taken;

  return (
    <div data-app-tile="postiz" data-postiz-state={status?.state ?? "loading"} className="flex min-w-0 flex-col rounded-xl px-2 py-2 transition-colors hover:bg-raised/40">
      <div className="flex items-center gap-3">
        <PostizIcon />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold leading-5 text-ink">Postiz</span>
            {connected && <Check size={13} strokeWidth={2.5} className="shrink-0 text-success" aria-label={t("apps.connected")} />}
          </div>
          <p className="truncate text-[13px] leading-[18px] text-ink-secondary" title={description}>{description}</p>
        </div>
        {waiting ? (
          <button type="button" onClick={cancel} className={pill}>{t("mcp.auth.cancel")}</button>
        ) : status === null ? (
          loadFailed
            ? <button type="button" onClick={() => void load()} className={pill}>{t("connectors.action.retry")}</button>
            : <button type="button" disabled className={pill} aria-label={t("common.checking")}><Loader2 size={14} className="animate-spin" /></button>
        ) : connected ? menu : offerConnect && !keyMode ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label={t(needsSignIn || refused ? "postiz.reconnect" : "postiz.connect")} disabled={busy !== null}
              onClick={() => refused ? (setKeyMode(true), setError(null)) : void connect()} className={pill}>
              {t(needsSignIn || refused ? "connectors.action.reconnect" : "connectors.action.connect")}
            </button>
            {menu}
          </div>
        ) : null}
      </div>
      <div className="ps-[52px]">
        {waiting && (
          <div role="status" className="mt-1.5 flex flex-col gap-1.5 text-[12px] text-ink-secondary">
            <p className="flex items-center gap-2">
              <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
              <span>{t(loadingTools ? "postiz.loadingTools" : "postiz.finishInBrowser")}</span>
              {flow?.authorizationUrl && mcpSignInLink(flow.authorizationUrl) && (
                <button type="button" onClick={() => void openExternalLink(flow.authorizationUrl!).catch(() => setError(t("mcp.auth.openFailed")))} className={link}>
                  {t("mcp.auth.openAgain")}
                </button>
              )}
            </p>
            {flow?.flowId && flow.pasteBack && (
              <form data-postiz-paste className="flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); void completePasted(); }}>
                <span className="leading-relaxed text-ink">{t("mcp.auth.pasteBackHint")}</span>
                <input type="text" value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} autoComplete="off" spellCheck={false}
                  aria-label={t("mcp.auth.callbackUrl")} placeholder="http://127.0.0.1:…/mcp-oauth/callback?…" className={field} />
                <button type="submit" disabled={!callbackUrl.trim()} className={pill}>{t("mcp.auth.complete")}</button>
              </form>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-1.5 text-[12px] text-danger">{error}</p>}
        {offerConnect && !waiting && (keyMode ? (
          <form data-postiz-key-form className="mt-2 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void connectWithKey(); }}>
            <input type="password" autoComplete="off" spellCheck={false} aria-label={t("postiz.keyField")} placeholder={t("keys.postiz.placeholder")}
              value={key} disabled={busy === "key"} onChange={(event) => { setError(null); setKey(event.target.value); }} className={field} />
            <input type="url" autoComplete="off" spellCheck={false} aria-label={t("postiz.addressField")} placeholder={POSTIZ_CLOUD}
              value={address} disabled={busy === "key"} onChange={(event) => { setError(null); setAddress(event.target.value); }} className={field} />
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("postiz.keyAndAddressHelp")}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button type="submit" disabled={busy !== null || !key.trim()} className={pill}>
                {busy === "key" ? <Loader2 size={14} className="animate-spin" /> : t("connectors.action.connect")}
              </button>
              <a href={POSTIZ_KEY_PAGE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline">
                {t("postiz.keyLink")}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
              <button type="button" onClick={() => { setKeyMode(false); setError(null); }} className="text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink">
                {t("postiz.useSignIn")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => { setKeyMode(true); setError(null); setAddress(status.selfHosted ? status.address : ""); }} className={`mt-1.5 inline-block ${link}`}>
            {t("postiz.useKey")}
          </button>
        ))}
      </div>
    </div>
  );
}
