import { useEffect, useState } from "react";
import { productName } from "../lib/brand";
import { disconnectServer, placeAvailable } from "../lib/place";

import {
  defaultDeviceLabel,
  isConnected,
  newAttemptId,
  pairWithCode,
  readSessionState,
  reasonWorthShowing,
  type EnvironmentDescriptor,
  type SessionState,
} from "../lib/session";
import { pairedDestination } from "../lib/phone-pairing";

const input = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-lg text-ink outline-none focus:border-accent-border";
const button = "mt-5 w-full rounded-md bg-accent px-4 py-2 text-lg font-medium text-accent-ink disabled:opacity-50";
const fieldLabel = "mt-4 block text-sm font-medium text-ink-secondary";

/** Only the desktop app pairs from a link at once; a browser asks, so a sent link cannot sign it in unseen. */
export function pairsAutomatically(initialCode: string | null, desktop = placeAvailable()): boolean {
  return Boolean(initialCode) && desktop;
}

export const PAIR_INTRO = "Enter the pairing code shown on the server. Codes work once and expire after five minutes.";

export function pairTitle(environment: EnvironmentDescriptor | null): string {
  return `Connect to ${environment?.label ?? `this ${productName()}`}`;
}

export function PairPage({ initialCode, reason }: { initialCode: string | null; reason?: string }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [label, setLabel] = useState(defaultDeviceLabel());
  const [environment, setEnvironment] = useState<EnvironmentDescriptor | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(() => newAttemptId());
  const [opening, setOpening] = useState(() => pairsAutomatically(initialCode));

  useEffect(() => {
    if (!opening || !initialCode) return;
    let active = true;
    void pairWithCode({ code: initialCode, label, attemptId }).then((result) => {
      if (!active) return;
      if (result.ok) { location.replace(pairedDestination(location.search)); return; }
      setOpening(false);
      setError(result.error);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetch("/.well-known/openmausbot/environment")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EnvironmentDescriptor | null) => setEnvironment(d))
      .catch(() => setEnvironment(null));
    void readSessionState().then(setSession);
  }, []);

  const connected = isConnected(session);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await pairWithCode({ code, label, attemptId });
    setBusy(false);
    if (result.ok) {
      location.replace(pairedDestination(location.search));
      return;
    }
    setError(result.error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-6 text-ink">
      {placeAvailable() && <button type="button" onClick={() => void disconnectServer()}
        className="absolute left-3 top-12 rounded-md px-2 py-1.5 text-base text-ink-secondary hover:bg-control hover:text-ink">Back to this computer</button>}
      <div className="w-full max-w-105">
        {opening ? (
          <p role="status" className="text-2xl font-semibold">{`Connecting to ${environment?.label ?? `this ${productName()}`}…`}</p>
        ) : <>
        <h1 className="text-2xl font-semibold">{pairTitle(environment)}</h1>
        <p className="mt-1.5 text-lg leading-relaxed text-ink-secondary">
          {environment ? `Version ${environment.version} on ${environment.platform}. ` : ""}
          {PAIR_INTRO}
        </p>
        {reasonWorthShowing(reason) && !connected ? <p className="mt-3 text-base text-ink-secondary">{reasonWorthShowing(reason)}</p> : null}
        </>}
        {opening ? null : connected ? (
          <p className="mt-4 text-lg">
            This browser is already connected.{" "}
            <a href="/" className="text-accent underline">
              Open the app
            </a>
          </p>
        ) : (
          <form onSubmit={submitCode}>
            <label className={fieldLabel} htmlFor="pair-code">
              Pairing code
            </label>
            <input
              id="pair-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setAttemptId(newAttemptId());
              }}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className={`${input} font-mono text-lg tracking-widest`}
            />
            <label className={fieldLabel} htmlFor="pair-label">
              This device
            </label>
            <input id="pair-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={input} />
            {error ? <p className="mt-3 text-base text-danger">{error}</p> : null}
            <button type="submit" disabled={busy || code.replace(/[^a-z0-9]/gi, "").length < 12} className={button}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
