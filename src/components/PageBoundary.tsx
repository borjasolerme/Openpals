import { Component, type ReactNode } from "react";

import { t } from "@/lib/i18n";

/** A piece of the app that could not be downloaded: after an update its file name changed, or a proxy dropped the
 * request. A reload fetches the page as it is now, so it is done once by itself before the person is asked. */
const CHUNK_LOAD = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/iu;
const RELOADED_AT = "openpals:chunk-reloaded-at";
const RELOAD_AGAIN_AFTER_MS = 60_000;

export function reloadOnceForChunk(error: Error, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.sessionStorage,
  reload: () => void = () => location.reload()): boolean {
  if (!CHUNK_LOAD.test(error.message)) return false;
  try {
    const last = Number(storage?.getItem(RELOADED_AT) ?? 0);
    if (now - last < RELOAD_AGAIN_AFTER_MS) return false;
    storage?.setItem(RELOADED_AT, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

// React unmounts everything below a root that has no error boundary when a render or an effect throws (react.dev,
// "Catching rendering errors with an error boundary"), which left a page showing only the body's background.
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error) {
    reloadOnceForChunk(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold">{t("page.broken.title")}</h1>
          <p className="text-lg opacity-75">{t("page.broken.body")}</p>
          <p className="break-words text-sm opacity-60">{this.state.error.message}</p>
          <button type="button" className="rounded-md border px-3 py-1.5 text-lg" onClick={() => location.reload()}>
            {t("page.broken.reload")}
          </button>
        </div>
      </div>
    );
  }
}
