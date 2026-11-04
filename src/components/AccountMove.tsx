// The one-time move to a server of the person's own in the account area at the bottom of the sidebar, never as a strip
// over the page: a short segment in the account's name, a line by the account (above it in Simple, under the name in
// Advanced), a dot on the avatar, and the move's own row at the top of the account menu. In the desktop app only.
import { useSyncExternalStore } from "react";
import { CloudAlert, CloudUpload, Loader2, RefreshCw } from "lucide-react";
import type { CloudSendPageBridge } from "../../electron/cloud-send.mjs";
import { ipcErrorText, moveLine } from "@/lib/cloud-send";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCloudSendNotice } from "./move-notice";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

export type AccountMoveLine = NonNullable<ReturnType<typeof moveLine>>;
export type AccountMoveKind = AccountMoveLine["kind"];

const pageBridge = () => (!window.ogb?.remoteClient?.active ? window.ogb?.cloudSendPage : undefined);

/** The account's words for the move: it needs the person once it has failed for a day, and goes quietly meanwhile.
 * `place`: the server of their own it goes to. */
export function accountMoveWords(kind: AccountMoveKind | null, place?: string): string | null {
  if (!place) return null;
  if (kind === "failed") return t("sidebar.account.moveNeedsYouNamed", { place });
  if (kind === "sending") return t("sidebar.account.movingNamed", { place });
  return null;
}

const failingPlain = (place: string) => t("cloudSend.move.failingPlainNamed", { place });

/** Why a failing move failed: main's words when Try again went unanswered, else the move's own reason. */
function failingWhy(line: AccountMoveLine, unanswered: string | null): string {
  const plain = failingPlain(line.place);
  return [unanswered && unanswered !== plain ? unanswered : line.reason, ...line.extra].filter(Boolean).join(" ") || plain;
}

/** The move's rows at the top of the account menu, each the size of every other row there. Failed: Try again, with why
 * in its tooltip and a spinner while it runs. On its way: one row, the progress in its tooltip. A row that does not retry
 * opens the servers in Settings. */
export function moveMenuItems(line: AccountMoveLine | null, { retrying = false, unanswered = null, onOpen, onRetry }: {
  retrying?: boolean;
  unanswered?: string | null;
  onOpen: () => void;
  onRetry: () => void;
}): SidebarMenuItem[] {
  if (!line) return [];
  if (line.kind === "sending") return [{ key: "cloud-move", label: accountMoveWords("sending", line.place)!, title: line.text, icon: <Loader2 size={16} className="animate-spin" />, onSelect: onOpen }];
  const title = failingWhy(line, unanswered);
  if (!line.retry) return [{ key: "cloud-move", label: accountMoveWords("failed", line.place)!, title, icon: <CloudAlert size={16} className="text-warning" />, onSelect: onOpen }];
  return [{
    key: "cloud-move",
    label: t("sidebar.account.moveRetryNamed", { place: line.place }),
    title,
    icon: retrying ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} className="text-warning" />,
    disabled: retrying,
    keepOpen: true,
    onSelect: onRetry,
  }];
}

type RetryState = { retrying: boolean; unanswered: string | null };
const IDLE: RetryState = { retrying: false, unanswered: null };

function retryStore() {
  let state = IDLE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: RetryState) => { state = next; for (const listener of listeners) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// The window has one move, so the account's line and every account menu share its one Try again.
const retries = new WeakMap<CloudSendPageBridge, ReturnType<typeof retryStore>>();
const offPage = retryStore();
function retryOf(bridge: CloudSendPageBridge | undefined) {
  if (!bridge) return offPage;
  const known = retries.get(bridge);
  if (known) return known;
  const store = retryStore();
  retries.set(bridge, store);
  return store;
}

function useMove() {
  const bridge = pageBridge();
  const [notice, setNotice] = useCloudSendNotice(bridge);
  const store = retryOf(bridge);
  const { retrying, unanswered } = useSyncExternalStore(store.subscribe, store.get, store.get);
  const line = bridge && notice?.move ? moveLine(notice.move) : null;
  if (!bridge || !notice || !line) return null;
  const retry = () => {
    if (store.get().retrying) return;
    store.set({ retrying: true, unanswered: null });
    void (bridge.moveRetry?.() ?? Promise.resolve(notice)).then((next) => { setNotice(next); store.set(IDLE); })
      .catch((cause: unknown) => { store.set({ retrying: false, unanswered: ipcErrorText(cause) ?? failingPlain(line.place) }); });
  };
  return { line, retrying, unanswered, retry };
}

/** The move as the account menu shows it: its kind and its rows, with the move's own Try again and close. */
export function useAccountMove({ onOpen }: { onOpen: () => void }): {
  kind: AccountMoveKind | null;
  items: SidebarMenuItem[];
  place?: string;
} {
  const move = useMove();
  if (!move) return { kind: null, items: [] };
  const { line, retrying, unanswered, retry } = move;
  return { kind: line.kind, items: moveMenuItems(line, { retrying, unanswered, onOpen, onRetry: retry }), place: line.place };
}

/** The line's Try again: what it runs, whether it is running, and why the move failed. */
export interface AccountMoveRetry {
  onRetry: () => void;
  retrying: boolean;
  why: string;
}

/** The move as Simple's line above the account shows it: its kind, and Try again while the failing move allows one. */
export function useAccountMoveLine(): { kind: AccountMoveKind | null; retry: AccountMoveRetry | null; place?: string } {
  const move = useMove();
  if (!move) return { kind: null, retry: null };
  const { line, retrying, unanswered, retry } = move;
  return { kind: line.kind, retry: line.kind === "failed" && line.retry ? { onRetry: retry, retrying, why: failingWhy(line, unanswered) } : null, place: line.place };
}

/** The account's line for the move: amber while it needs the person, quiet while it goes, nothing otherwise. With
 * `onOpen` its words are a button that opens the account menu, followed by Try again when `retry` allows one; without,
 * words inside a trigger. The words shorten before Try again does. */
export function AccountMoveStatus({ kind, place, retry = null, onOpen, className }: { kind: AccountMoveKind | null; place?: string; retry?: AccountMoveRetry | null; onOpen?: () => void; className?: string }) {
  const words = accountMoveWords(kind, place);
  if (!words) return null;
  const Icon = kind === "failed" ? CloudAlert : CloudUpload;
  const look = cn("flex min-w-0 items-center gap-1.5 text-start text-[12px] leading-4", kind === "failed" ? "font-medium text-warning" : "text-ink-secondary");
  const body = <>
    <Icon size={13} aria-hidden="true" className="shrink-0" />
    <span className="truncate">{words}</span>
  </>;
  if (!onOpen) return <span data-account-move={kind} className={cn(look, className)}>{body}</span>;
  return (
    <div role="status" data-account-move={kind} className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <button type="button" onClick={onOpen} className={cn(look, kind === "failed" ? "hover:underline" : "hover:text-ink")}>{body}</button>
      {kind === "failed" && retry && (
        <button
          type="button"
          data-move-retry
          aria-label={t("sidebar.account.moveRetryNameNamed", { place: place ?? "" })}
          aria-busy={retry.retrying || undefined}
          aria-disabled={retry.retrying || undefined}
          title={retry.why}
          onClick={retry.retrying ? undefined : retry.onRetry}
          className={cn("ui-button ui-button-sm shrink-0", retry.retrying && "cursor-progress")}
        >
          {retry.retrying && <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />}
          {t("cloudSend.strip.retry")}
        </button>
      )}
    </div>
  );
}
