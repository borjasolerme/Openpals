import { companionBridge } from "@/lib/companion-bridge";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { t } from "@/lib/i18n";
import {
  Check,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { phonePairingLink } from "../../shared/pairing-link";
import {
  companionPairingRoute,
  companionPairingRoutePin,
  companionPairingRoutePinAvailable,
  type CompanionEndpoint,
  type CompanionPairingRoutePin,
  type CompanionPairingRouteMode,
} from "../lib/companion-pairing";
import {
  claimPhonePairingAttempt,
  closePhonePairingIfOwned,
  completePhonePairingAttempt,
  companionPairingOpenFailure,
  companionStartFailure,
  derivePhoneSetupPhase,
  initialPhoneSetupFlowState,
  keepPhonePairingIfCurrent,
  invalidatePhonePairingAttempt,
  newlyPairedDeviceForFlow,
  phoneSetupBaseline,
  phoneSetupReducer,
  preparePhonePairingRoute,
  queuePhonePairingAttempt,
  releasePhonePairingAttempt,
  startNonOverlappingPhoneSetupPoll,
  type PhoneSetupPhase,
  type PhonePairingAttemptLock,
  type PhonePairingAttemptQueue,
} from "../lib/phone-setup";
import {
  companionStateRefreshIsCurrent,
  mutateCompanionBridgeState,
  phonePairingManualCodeMode,
} from "../lib/companion-state";
import { ConnectionDetail } from "./ConnectionDetail";
import { productName } from "../lib/brand";

export interface PhoneDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  cloudDesktopAccess: boolean;
  /** Absent (older sidecars) means no browser access. */
  browserControlAccess?: boolean;
}

export interface CompanionState {
  enabled: boolean;
  keepAwake: boolean;
  port: number;
  devices: PhoneDevice[];
  connectedDeviceIds?: string[];
  pairing: { code: string; token: string; expiresAt: number } | null;
  addresses?: string[];
  tailscale?: string;
  tailnetName?: string;
  lan?: string | null;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
  secretPublicKey?: string;
  discovery?: { advertising: boolean; name: string };
  /** Windows has that network down as Public, where its firewall drops a phone's connection. */
  publicNetwork?: string;
  error?: string;
}

export type CompanionBridge = {
  state: () => Promise<CompanionState>;
  start: () => Promise<CompanionState>;
  stop: () => Promise<CompanionState>;
  keepAwake: (enabled: boolean) => Promise<CompanionState>;
  refreshTailscale: () => Promise<CompanionState>;
  pairing: (open: boolean, expectedToken?: string) => Promise<CompanionState>;
  cloudDesktop: (deviceId: string, allowed: boolean) => Promise<CompanionState>;
  browserControl: (deviceId: string, allowed: boolean) => Promise<CompanionState>;
  revoke: (deviceId: string) => Promise<CompanionState>;
};

// Functions, not constants: a message resolved at import time would keep the language the app booted in.
const routeUnavailable = (route: CompanionPairingRouteMode) =>
  t(route === "tailscale" ? "phone.error.tailscaleUnavailable" : "phone.error.directUnavailable");

interface OwnedCompanionPairingRoutePin extends CompanionPairingRoutePin {
  generation: number;
  token: string;
}

interface PhonePairingRequest {
  routeMode: CompanionPairingRouteMode;
  generation: number;
}

export { companionBridge };

export interface PhoneSetupController {
  state: CompanionState | null;
  phase: PhoneSetupPhase;
  /** The way the flow pairs: the one the person chose, else the tailnet when it can be used, else this network. */
  route: CompanionPairingRouteMode;
  busy: boolean;
  error: string | null;
  pairingLink: string | null;
  secondsLeft: number;
  address: string | undefined;
  pairingPort: number;
  tailscaleAvailable: boolean;
  pairingExpired: boolean;
  start: () => void;
  useLocal: () => void;
  useTailscale: () => void;
  refreshTailscale: () => void;
  cancel: () => void;
  refreshCode: () => void;
  finish: () => void;
  act: (call: (companion: CompanionBridge) => Promise<CompanionState>) => Promise<void>;
}

export function usePhoneSetupController(): PhoneSetupController {
  const [state, setState] = useState<CompanionState | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [flow, dispatchFlow] = useReducer(phoneSetupReducer, initialPhoneSetupFlowState);
  const pairingUiOwner = useRef<PhonePairingAttemptLock>({ generation: null });
  const pairingAttemptQueue = useRef<PhonePairingAttemptQueue<PhonePairingRequest>>({
    active: null,
    pending: null,
  });
  const runPairingAttemptRef = useRef<(request: PhonePairingRequest) => Promise<void>>(
    async () => {},
  );
  const pairingRoutePinRef = useRef<OwnedCompanionPairingRoutePin | null>(null);
  const [pairingRoutePinState, setPairingRoutePinState] =
    useState<OwnedCompanionPairingRoutePin | null>(null);
  const setupGeneration = useRef(0);
  const mounted = useRef(true);
  const companionMutationEpoch = useRef(0);
  const loadInFlight = useRef<Promise<void> | null>(null);

  const publishPairingRoutePin = useCallback((pin: OwnedCompanionPairingRoutePin | null) => {
    pairingRoutePinRef.current = pin;
    setPairingRoutePinState(pin);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setupGeneration.current += 1;
    };
  }, []);

  const load = useCallback((): Promise<void> => {
    if (loadInFlight.current) return loadInFlight.current;
    const refreshEpoch = companionMutationEpoch.current;
    const companion = companionBridge();
    const pending = (async () => {
      const next = companion ? await companion.state().catch(() => null) : null;
      if (!mounted.current) return;
      if (next && companionStateRefreshIsCurrent(companionMutationEpoch, refreshEpoch)) setState(next);
    })().finally(() => {
      if (loadInFlight.current === pending) loadInFlight.current = null;
    });
    loadInFlight.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(async (call: (companion: CompanionBridge) => Promise<CompanionState>) => {
    const companion = companionBridge();
    if (!companion) return;
    setActionBusy(true);
    setError(null);
    try {
      const next = await mutateCompanionBridgeState(
        companionMutationEpoch,
        () => call(companion),
      );
      if (mounted.current) setState(next);
    } catch {
      if (mounted.current) setError(t("phone.error.remoteUpdate"));
    } finally {
      if (mounted.current) setActionBusy(false);
    }
  }, []);

  const runPairingAttempt = useCallback(
    async ({ routeMode, generation }: PhonePairingRequest) => {
      const finishAttempt = () => {
        if (releasePhonePairingAttempt(pairingUiOwner.current, generation) && mounted.current) {
          setPairingBusy(false);
        }
        const next = completePhonePairingAttempt(pairingAttemptQueue.current, generation);
        if (next) void runPairingAttemptRef.current(next);
      };
      const isCurrent = () => mounted.current && setupGeneration.current === generation;
      if (!isCurrent()) {
        finishAttempt();
        return;
      }
      const companion = companionBridge();
      if (!companion) {
        if (mounted.current && setupGeneration.current === generation) {
          setError(t("phone.error.desktopOnly"));
        }
        finishAttempt();
        return;
      }
      const staleAttemptMayClose = () => {
        const activePin = pairingRoutePinRef.current;
        return !activePin || activePin.generation === generation;
      };
      const previousPin = pairingRoutePinRef.current;
      if (previousPin && previousPin.generation !== generation) {
        publishPairingRoutePin(null);
        setState((current) => current?.pairing?.token === previousPin.token
          ? { ...current, pairing: null }
          : current);
      }
      setError(null);
      try {
        const started = await preparePhonePairingRoute(
          routeMode,
          Boolean(state?.enabled),
          {
            read: () => companion.state(),
            start: () => mutateCompanionBridgeState(
              companionMutationEpoch,
              () => companion.start(),
            ),
            refreshTailscale: () => mutateCompanionBridgeState(
              companionMutationEpoch,
              () => companion.refreshTailscale(),
            ),
            shouldContinue: isCurrent,
          },
        );
        if (!isCurrent()) return;
        setState(started);
        const startFailure = companionStartFailure(started);
        if (startFailure) {
          setError(startFailure);
          dispatchFlow({ type: "reset" });
          return;
        }
        if (!companionPairingRoute(started, routeMode)) {
          setError(routeUnavailable(routeMode));
          dispatchFlow({ type: "reset" });
          return;
        }
        const paired = await keepPhonePairingIfCurrent(
          () => mutateCompanionBridgeState(
            companionMutationEpoch,
            () => companion.pairing(true),
          ),
          (opened) => closePhonePairingIfOwned(
            opened,
            () => companion.state(),
            () => mutateCompanionBridgeState(
              companionMutationEpoch,
              () => companion.pairing(false, opened.pairing?.token),
            ),
            staleAttemptMayClose,
          ),
          isCurrent,
        );
        if (!paired) return;

        const pairingWindow = paired.pairing;
        const pairingFailure = companionPairingOpenFailure(
          paired,
          started.pairing?.token ?? null,
        );
        const routePin = pairingFailure ? null : companionPairingRoutePin(paired, routeMode);
        if (pairingFailure || !routePin || !pairingWindow) {
          await closePhonePairingIfOwned(
            paired,
            () => companion.state(),
            () => mutateCompanionBridgeState(
              companionMutationEpoch,
              () => companion.pairing(false, paired.pairing?.token),
            ),
            isCurrent,
          );
          if (!isCurrent()) return;
          publishPairingRoutePin(null);
          setState({ ...paired, pairing: null });
          setError(pairingFailure ?? routeUnavailable(routeMode));
          dispatchFlow({ type: "reset" });
          return;
        }
        publishPairingRoutePin({
          ...routePin,
          generation,
          token: pairingWindow.token,
        });
        setState(paired);
        dispatchFlow({
          type: "pairing-opened",
          deviceIds: paired.devices.map((device) => device.id),
        });
      } catch {
        if (!isCurrent()) return;
        publishPairingRoutePin(null);
        setError(t("phone.error.pairingPrepare"));
        dispatchFlow({ type: "reset" });
      } finally {
        finishAttempt();
      }
    },
    [publishPairingRoutePin, state],
  );

  useLayoutEffect(() => {
    runPairingAttemptRef.current = runPairingAttempt;
  }, [runPairingAttempt]);

  const openPairing = useCallback((routeMode: CompanionPairingRouteMode, generation: number) => {
    const request = { routeMode, generation };
    const decision = queuePhonePairingAttempt(pairingAttemptQueue.current, request);
    if (decision === "duplicate") return;
    claimPhonePairingAttempt(pairingUiOwner.current, generation);
    setPairingBusy(true);
    if (decision === "start") void runPairingAttemptRef.current(request);
  }, []);

  const tailscaleAvailable = Boolean(state && companionPairingRoute(state, "tailscale"));
  const route: CompanionPairingRouteMode = flow.route ?? (tailscaleAvailable ? "tailscale" : "local");

  const startOver = useCallback((next: CompanionPairingRouteMode) => {
    const baseline = phoneSetupBaseline(state?.devices ?? null);
    if (!baseline) return;
    const generation = ++setupGeneration.current;
    dispatchFlow({ type: "start", deviceIds: baseline, route: next });
    setError(null);
    openPairing(next, generation);
  }, [openPairing, state?.devices]);

  const refreshTailscale = useCallback(() => {
    void act((companion) => companion.refreshTailscale());
  }, [act]);

  const phase = derivePhoneSetupPhase(
    flow,
    Boolean(state?.pairing && pairingRoutePinState?.token === state.pairing.token),
  );

  useEffect(() => {
    const pin = pairingRoutePinState;
    if (!pin || !state) return;
    if (!state.pairing) {
      publishPairingRoutePin(null);
      return;
    }

    const tokenMatches = state.pairing.token === pin.token;
    const routeAvailable = companionPairingRoutePinAvailable(state, pin);
    if (tokenMatches && routeAvailable) return;

    const companion = companionBridge();
    if (setupGeneration.current === pin.generation) setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, pin.generation);
    releasePhonePairingAttempt(pairingUiOwner.current, pin.generation);
    setPairingBusy(false);
    publishPairingRoutePin(null);
    setState((current) => current ? { ...current, pairing: null } : current);
    setError(tokenMatches
      ? t("phone.error.tailscaleUnavailable")
      : t("phone.error.codeChanged"));
    dispatchFlow({ type: "reset" });

    if (tokenMatches && companion) {
      void closePhonePairingIfOwned(
        state,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          companionMutationEpoch,
          () => companion.pairing(false, state.pairing?.token),
        ),
        () => {
          const activePin = pairingRoutePinRef.current;
          return !activePin || activePin.generation === pin.generation;
        },
      );
    }
  }, [pairingRoutePinState, publishPairingRoutePin, state]);

  useEffect(() => {
    if (!state) return;
    const device = newlyPairedDeviceForFlow(flow, state.devices);
    if (device) dispatchFlow({ type: "paired", deviceName: device.name });
  }, [flow, state]);

  const shouldPoll = flow.active || Boolean(state?.pairing);
  useEffect(() => {
    return startNonOverlappingPhoneSetupPoll(
      () => {
        setNow(Date.now());
        return load();
      },
      shouldPoll ? 1_000 : 10_000,
    );
  }, [load, shouldPoll]);

  const pairingRoute = useMemo(
    () => {
      if (!state) return null;
      if (state.pairing) {
        return pairingRoutePinState?.token === state.pairing.token
          ? pairingRoutePinState.route
          : null;
      }
      return companionPairingRoute(state, route);
    },
    [route, pairingRoutePinState, state],
  );
  const pairingLink = useMemo(() => {
    if (!state?.pairing || !pairingRoute) return null;
    return phonePairingLink({
      ...pairingRoute,
      code: state.pairing.code,
      token: state.pairing.token,
      name: state.discovery?.name,
      secretPublicKey: state.secretPublicKey,
    });
  }, [pairingRoute, state]);

  const cancel = useCallback(() => {
    const cancelledGeneration = setupGeneration.current;
    setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, cancelledGeneration);
    releasePhonePairingAttempt(pairingUiOwner.current, cancelledGeneration);
    setPairingBusy(false);
    const snapshot = state;
    const companion = companionBridge();
    publishPairingRoutePin(null);
    setState((current) => current ? { ...current, pairing: null } : current);
    if (companion && snapshot?.pairing) {
      void closePhonePairingIfOwned(
        snapshot,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          companionMutationEpoch,
          () => companion.pairing(false, snapshot.pairing?.token),
        ),
        () => pairingRoutePinRef.current === null,
      );
    }
    dispatchFlow({ type: "reset" });
  }, [publishPairingRoutePin, state]);

  return {
    state,
    phase,
    route,
    busy: actionBusy || pairingBusy,
    error,
    pairingLink,
    secondsLeft: state?.pairing
      ? Math.max(0, Math.round((state.pairing.expiresAt - now) / 1000))
      : 0,
    address: pairingRoute?.address,
    pairingPort: pairingRoute?.port ?? state?.port ?? 8810,
    tailscaleAvailable,
    pairingExpired: flow.pairingAttempted && !state?.pairing,
    start: () => startOver(route),
    useLocal: () => startOver("local"),
    useTailscale: () => startOver("tailscale"),
    refreshTailscale,
    cancel,
    refreshCode: () => openPairing(route, ++setupGeneration.current),
    finish: () => {
      const generation = setupGeneration.current;
      setupGeneration.current += 1;
      invalidatePhonePairingAttempt(pairingAttemptQueue.current, generation);
      releasePhonePairingAttempt(pairingUiOwner.current, generation);
      setPairingBusy(false);
      publishPairingRoutePin(null);
      dispatchFlow({ type: "reset" });
    },
    act,
  };
}

function ValuePoints() {
  const points: Array<{ Icon: typeof Smartphone; title: string; detail: string }> = [
    { Icon: Smartphone, title: t("phone.value.chats"), detail: t("phone.value.chatsDetail") },
    { Icon: Check, title: t("phone.value.approvals"), detail: t("phone.value.approvalsDetail") },
    { Icon: ShieldCheck, title: t("phone.value.private"), detail: t("phone.value.privateDetail") },
  ];
  return (
    <div className="mt-5 grid w-full gap-2 sm:grid-cols-3">
      {points.map(({ Icon, title, detail }) => (
        <div key={title} className="rounded-xl bg-inset px-3 py-3 text-left">
          <Icon size={16} className="text-accent" />
          <div className="mt-2 text-[13px] font-medium text-ink">{title}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{detail}</div>
        </div>
      ))}
    </div>
  );
}

export function PhoneSetupFlowView({ controller }: { controller: PhoneSetupController }) {
  const c = controller;
  const manualCodeMode = phonePairingManualCodeMode(Boolean(c.state?.pairing), c.pairingLink);

  if (c.phase === "intro") {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Smartphone size={26} />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold text-ink">{t("phone.intro.title", { app: productName() })}</h2>
        <p className="mt-1.5 max-w-[460px] text-[14px] leading-relaxed text-ink-secondary">
          {t("phone.intro.detail")}
        </p>
        <ValuePoints />
        <button
          data-phone-pairing-action
          onClick={c.start}
          disabled={!c.state || c.busy}
          className="mt-5 w-full max-w-[320px] rounded-lg bg-accent py-2.5 text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-40"
        >
          {c.state?.devices.length ? t("phone.intro.pairAnother") : t("phone.intro.pair")}
        </button>
        {c.route === "tailscale" && (
          <>
            <button
              disabled={!c.state || c.busy}
              onClick={c.useLocal}
              className="mt-3 flex items-center justify-center gap-2 text-[13px] text-ink-secondary hover:text-ink disabled:opacity-40"
            >
              <Wifi size={15} /> {t("phone.signIn.wifiInstead")}
            </button>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">{t("phone.signIn.wifiNote")}</p>
          </>
        )}
        {c.error && <p role="alert" className="mt-3 max-w-[390px] text-[13px] text-danger">{c.error}</p>}
      </div>
    );
  }

  if (c.phase === "verifying") {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Loader2 size={25} className="animate-spin" />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold text-ink">
          {c.route === "tailscale" ? t("phone.verifying.tailscale") : t("phone.verifying.local")}
        </h2>
        <p className="mt-1.5 max-w-[360px] text-[13px] leading-relaxed text-ink-secondary">
          {c.route === "tailscale" ? t("phone.verifying.tailscaleDetail") : t("phone.verifying.localDetail")}
        </p>
        {c.error && <p role="alert" className="mt-3 max-w-[380px] text-[13px] text-danger">{c.error}</p>}
        <button onClick={c.cancel} className="mt-5 text-[12px] text-ink-secondary hover:text-ink">{t("common.cancel")}</button>
      </div>
    );
  }

  if (c.phase === "success") {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <Check size={28} />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold text-ink">{t("phone.success.title")}</h2>
        <p className="mt-1.5 text-[13px] text-ink-secondary">
          {t("phone.success.detail")}
        </p>
        <button
          onClick={c.finish}
          className="mt-5 w-full max-w-[280px] rounded-lg bg-accent py-2.5 text-[14px] font-medium text-white"
        >
          {t("phone.success.done")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-white text-black">
        <QrCode size={23} />
      </div>
      <h2 className="mt-3 text-[18px] font-semibold text-ink">
        {c.pairingExpired ? t("phone.code.expired") : t("phone.code.title")}
      </h2>
      <p className="mt-1 text-[13px] text-ink-secondary">
        {c.pairingExpired ? t("phone.code.expiredDetail") : t("phone.code.detail")}
      </p>
      {!c.pairingExpired && c.pairingLink && (
        <div className="mt-4 rounded-2xl bg-white p-3.5" aria-label={t("phone.code.qrAria")}>
          <QRCodeSVG value={c.pairingLink} size={180} level="M" bgColor="#ffffff" fgColor="#111111" />
        </div>
      )}
      {!c.pairingExpired && manualCodeMode === "direct" && c.state?.pairing && (
        <div className="mt-4 w-full max-w-[320px] rounded-xl bg-inset px-4 py-3 text-[13px] text-ink-secondary">
          <div>{t("phone.code.manualIntro")}</div>
          <div className="mt-2 font-mono text-[22px] tracking-[0.25em] text-ink">
            {c.state.pairing.code}
          </div>
        </div>
      )}
      {!c.pairingExpired && manualCodeMode === "details" && c.state?.pairing && (
        <p className="mt-3 text-[12px] text-ink-secondary">{t("phone.code.expiresIn", { seconds: c.secondsLeft })}</p>
      )}
      {!c.pairingExpired && c.route === "local" && c.state?.publicNetwork && (
        <p role="note" className="mt-3 w-full max-w-[390px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-[12px] leading-relaxed text-warning">
          {t("phone.code.publicNetwork", { network: c.state.publicNetwork })}
        </p>
      )}
      {c.pairingExpired && (
        <button onClick={c.refreshCode} className="mt-5 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-white">
          {t("phone.code.createNew")}
        </button>
      )}
      {!c.pairingExpired && c.state?.pairing && (
        <details className="mt-4 w-full max-w-[390px] rounded-lg border border-hairline/40 px-3 py-2 text-left">
          <summary className="cursor-pointer text-[12px] text-ink-secondary">{t("phone.code.trouble")}</summary>
          <div className="mt-3 text-[12px] text-ink-secondary">
            {t("phone.code.manual")}
            <div className="mt-1 font-mono text-[22px] tracking-[0.25em] text-ink">{c.state.pairing.code}</div>
            {c.address && (
              <div className="mt-3">
                <ConnectionDetail label={t("phone.code.address")} value={`${c.address}:${c.pairingPort}`} />
              </div>
            )}
          </div>
        </details>
      )}
      <button onClick={c.cancel} className="mt-4 text-[12px] text-ink-secondary hover:text-ink">{t("common.cancel")}</button>
    </div>
  );
}

