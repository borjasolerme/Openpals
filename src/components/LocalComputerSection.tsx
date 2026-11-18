import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AlertTriangle, Cloud, Loader2, Moon, RefreshCw, Trash2 } from "lucide-react";
import { Card } from "./ui/Card";
import { MacLocalControl } from "./MacLocalControl";
import { cn } from "@/lib/cn";
import { VpsComputersCard } from "./VpsComputersCard"; import { KeysLink } from "./keys/KeysLink";

export interface CloudComputerInventoryInstance {
  boxId: string;
  name: string;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface CloudComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: CloudComputerInventoryInstance[];
}

type CloudAction = "sleep" | "delete";
type PendingCloudAction = { boxId: string; action: CloudAction } | null;
export type CloudPostActionOverride = "deleted" | "deleting" | "sleeping";
export type CloudPostActionOverrides = Record<string, CloudPostActionOverride>;

const PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function waitForCloudDeleteRefresh(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

export interface VpsComputerInventoryInstance {
  name: string;
  state: "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead" | "unknown";
  /** The SSH alias whose host holds this computer. */
  vpsAlias: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

interface VpsComputerInventoryPayload {
  configured: boolean;
  available: boolean;
  /** The default alias first, then each bot's own. */
  vpsAliases: string[];
  problem: string | null;
  instances: VpsComputerInventoryInstance[];
}

export type ComputerStateKind =
  | "unmanaged"
  | "in-use"
  | "stopped"
  | "running"
  | "attention"
  | "sleeping"
  | "going-to-sleep"
  | "starting"
  | "restarting"
  | "removing"
  | "paused";

const stateLabelKeys: Record<ComputerStateKind, LocaleKey> = {
  unmanaged: "vm.state.notManaged",
  "in-use": "vm.state.inUse",
  stopped: "vm.state.stopped",
  running: "vm.state.running",
  attention: "vm.state.attention",
  sleeping: "vm.state.sleeping",
  "going-to-sleep": "vm.state.goingToSleep",
  starting: "vm.state.starting",
  restarting: "vm.state.restarting",
  removing: "vm.state.removing",
  paused: "vm.state.paused",
};

export function computerStateLabel(kind: ComputerStateKind): string {
  return t(stateLabelKeys[kind]);
}

export function cloudComputerInventoryStateKind(
  instance: CloudComputerInventoryInstance,
): ComputerStateKind {
  if (instance.inUse) return "in-use";
  if (instance.state === "removing") return "removing";
  if (instance.state === "archived") return "sleeping";
  if (instance.state === "archiving") return "going-to-sleep";
  if (["idle", "ready", "running"].includes(instance.state)) return "running";
  if (["init", "provisioning", "provisioned", "cloning"].includes(instance.state)) return "starting";
  return "attention";
}

export function cloudComputerInventoryState(instance: CloudComputerInventoryInstance): string {
  return computerStateLabel(cloudComputerInventoryStateKind(instance));
}

/** Boat's account LIST is eventually consistent: an older snapshot must not undo an action the provider accepted. */
export function reconcileCloudInventorySnapshot(
  incoming: CloudComputerInventoryInstance[],
  previous: CloudComputerInventoryInstance[],
  overrides: CloudPostActionOverrides,
): { instances: CloudComputerInventoryInstance[]; overrides: CloudPostActionOverrides } {
  const nextOverrides = { ...overrides };
  const incomingIds = new Set(incoming.map((instance) => instance.boxId));
  const instances = incoming.flatMap((instance) => {
    const override = overrides[instance.boxId];
    if (override === "deleted") return [];
    if (override === "deleting") return [{ ...instance, state: "removing" }];
    if (override !== "sleeping") return [instance];
    if (instance.state === "archived") {
      delete nextOverrides[instance.boxId];
      return [instance];
    }
    return [{ ...instance, state: "archived" }];
  });

  // A transitioning Boat can briefly disappear from LIST.
  for (const instance of previous) {
    if (overrides[instance.boxId] !== "sleeping" || incomingIds.has(instance.boxId)) continue;
    instances.push({ ...instance, state: "archived" });
  }
  for (const [boxId, override] of Object.entries(overrides)) {
    if ((override === "deleted" || override === "deleting") && !incomingIds.has(boxId)) {
      delete nextOverrides[boxId];
    }
  }
  return { instances, overrides: nextOverrides };
}

/** An empty list proves deletion only when Boat says the read was authoritative. */
export function reconcileCloudInventoryPayload(
  payload: CloudComputerInventoryPayload,
  previous: CloudComputerInventoryInstance[],
  overrides: CloudPostActionOverrides,
): { instances: CloudComputerInventoryInstance[]; overrides: CloudPostActionOverrides } {
  if (payload.configured !== true || payload.available !== true) {
    return { instances: previous, overrides: { ...overrides } };
  }
  return reconcileCloudInventorySnapshot(
    Array.isArray(payload.instances) ? payload.instances : [],
    previous,
    overrides,
  );
}

function cloudComputerCanSleep(instance: CloudComputerInventoryInstance): boolean {
  return ["idle", "ready", "running"].includes(instance.state);
}

export function vpsComputerInventoryStateKind(
  instance: VpsComputerInventoryInstance,
): ComputerStateKind {
  if (instance.inUse) return "in-use";
  if (instance.state === "running") return "running";
  if (instance.state === "restarting") return "restarting";
  if (instance.state === "removing") return "removing";
  if (["created", "exited"].includes(instance.state)) return "stopped";
  if (instance.state === "paused") return "paused";
  return "attention";
}

export function vpsComputerInventoryState(instance: VpsComputerInventoryInstance): string {
  return computerStateLabel(vpsComputerInventoryStateKind(instance));
}

export function vpsComputerShortId(name: string): string {
  const suffix = /-([a-f0-9]{12})$/i.exec(name)?.[1];
  return suffix ? suffix.slice(-8).toLowerCase() : "unknown";
}

type ComputerInventoryRequest = "cloud" | "vps";
type ComputerApiRequest = [url: string, init: RequestInit];
export interface ComputerActionPlan {
  confirmation: string | null;
  request: ComputerApiRequest;
}

const computerInventoryPaths: Record<ComputerInventoryRequest, string> = {
  cloud: "/api/computers/boxes",
  vps: "/api/computers/vps",
};

/** Observation only: opening Computers must never provision or wake anything. */
export function computerInventoryRequest(
  inventory: ComputerInventoryRequest,
  signal?: AbortSignal,
): ComputerApiRequest {
  return [computerInventoryPaths[inventory], { signal }];
}

function jsonPostRequest(url: string, body: unknown): ComputerApiRequest {
  return [url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }];
}

export function cloudComputerActionPlan(
  action: CloudAction,
  instance: CloudComputerInventoryInstance,
): ComputerActionPlan {
  return {
    confirmation: action === "delete"
      ? t("vm.confirm.deleteCloud", {
          subject: instance.orphaned
            ? t("vm.confirm.orphanCloud")
            : t("vm.confirm.ownedCloud", { name: instance.ownerName ?? "" }),
        })
      : null,
    request: jsonPostRequest(
      `/api/computers/boxes/${encodeURIComponent(instance.boxId)}/${action}`,
      action === "delete" ? { confirmName: instance.name } : {},
    ),
  };
}

export function vpsComputerRemovePlan(instance: VpsComputerInventoryInstance): ComputerActionPlan {
  const shortId = vpsComputerShortId(instance.name);
  return {
    confirmation: t("vm.confirm.removeVps", {
      subject: instance.orphaned
        ? t("vm.confirm.orphanVps", { id: shortId })
        : t("vm.confirm.ownedVps", { name: instance.ownerName ?? "" }),
    }),
    request: jsonPostRequest(`/api/computers/vps/${encodeURIComponent(instance.name)}/remove`, {
      confirmName: instance.name,
      alias: instance.vpsAlias,
    }),
  };
}

export function confirmComputerAction(
  plan: ComputerActionPlan,
  confirm: (message: string) => boolean,
): ComputerApiRequest | null {
  if (plan.confirmation !== null && !confirm(plan.confirmation)) return null;
  return plan.request;
}

export function CloudComputersCard({
  instances,
  configured,
  loading,
  pending,
  error,
  unavailableReason,
  onRefresh,
  onSleep,
  onDelete,
}: {
  instances: CloudComputerInventoryInstance[];
  configured: boolean | null;
  loading: boolean;
  pending: PendingCloudAction;
  error: string | null;
  unavailableReason: string | null;
  onRefresh: () => void;
  onSleep: (instance: CloudComputerInventoryInstance) => void;
  onDelete: (instance: CloudComputerInventoryInstance) => void;
}) {
  return (
    <Card
      title={t("vm.cloud.title")}
      subtitle={t("vm.cloud.subtitle")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink-secondary">
          {configured === true
            ? t("vm.cloud.includesOrphans")
            : configured === false
              ? <>{t("vm.cloud.needsKey")} <KeysLink id="box" /></>
              : t("vm.cloud.refreshHint")}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || pending !== null}
          aria-label={t("vm.cloud.refreshAria")}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-sm text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {t("vm.refresh")}
        </button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loading
          ? t("vm.cloud.checking")
          : unavailableReason
            ? t("vm.cloud.unavailable", { reason: unavailableReason })
            : configured === false
              ? t("vm.cloud.notConnected")
              : instances.length === 1
                ? t("vm.cloud.foundOne")
                : t("vm.cloud.foundMany", { count: instances.length })}
      </p>

      {!(configured === false && !loading && !unavailableReason) && <div
        aria-busy={loading || pending !== null}
        className="mt-3 overflow-hidden rounded-xl border border-hairline/40"
      >
        {loading && instances.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-base text-ink-secondary">
            <Loader2 size={13} className="animate-spin" /> {t("vm.cloud.checkingList")}
          </div>
        ) : unavailableReason ? (
          <div className="flex items-center gap-2 px-3 py-4 text-base text-ink-secondary">
            <AlertTriangle size={14} className="shrink-0 text-warning" /> {unavailableReason}
          </div>
        ) : configured === false ? (
          <div className="flex items-center gap-2 px-3 py-4 text-base text-ink-secondary">
            <Cloud size={14} className="shrink-0" /> {t("vm.cloud.notConnected")}
          </div>
        ) : instances.length === 0 ? (
          <div className="px-3 py-4 text-base text-ink-secondary">{t("vm.cloud.noneFound")}</div>
        ) : instances.map((instance, index) => {
          const kind = cloudComputerInventoryStateKind(instance);
          const state = computerStateLabel(kind);
          const isPending = pending?.boxId === instance.boxId;
          const canSleep = cloudComputerCanSleep(instance);
          const isRemoving = kind === "removing";
          return (
            <div
              key={instance.boxId}
              className={cn(
                "flex items-start justify-between gap-3 px-3 py-3",
                index > 0 && "border-t border-hairline/35",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-lg font-medium text-ink">
                    {instance.orphaned ? t("vm.cloud.orphan") : instance.ownerName}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      instance.inUse || kind === "running"
                        ? "bg-success/15 text-success"
                        : kind === "sleeping" || kind === "going-to-sleep"
                          ? "bg-control text-ink-secondary"
                          : "bg-warning/15 text-warning",
                    )}
                  >
                    {state}
                  </span>
                </div>
                <div className="mt-1 break-all text-sm text-ink-secondary">
                  {instance.orphaned ? t("vm.owner.gone") : t("vm.owner.owned")} · {instance.name}
                </div>
                {instance.inUse && (
                  <div className="mt-1 text-sm text-ink-secondary">{t("vm.cloud.stopFirst")}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSleep(instance)}
                  disabled={loading || instance.inUse || pending !== null || !canSleep}
                  aria-busy={isPending && pending?.action === "sleep" ? true : undefined}
                  title={canSleep ? t("vm.cloud.sleepTitle") : t("vm.cloud.sleepBlocked", { state: state.toLowerCase() })}
                  className="flex items-center gap-1.5 rounded-lg border border-hairline/40 px-2.5 py-1.5 text-sm text-ink-secondary hover:bg-control hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending && pending?.action === "sleep" ? <Loader2 size={12} className="animate-spin" /> : <Moon size={12} />}
                  {t("vm.cloud.sleep")}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(instance)}
                  disabled={loading || instance.inUse || pending !== null || isRemoving}
                  aria-busy={isPending && pending?.action === "delete" ? true : undefined}
                  title={t("vm.cloud.deleteTitle")}
                  className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-sm font-medium text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending && pending?.action === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {t("common.delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>}
    </Card>
  );
}

export function LocalComputerSection() {
  const [cloudInventory, setCloudInventory] = useState<CloudComputerInventoryInstance[]>([]);
  const [cloudConfigured, setCloudConfigured] = useState<boolean | null>(null);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudUnavailableReason, setCloudUnavailableReason] = useState<string | null>(null);
  const [cloudPending, setCloudPending] = useState<PendingCloudAction>(null);
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);
  const cloudInventoryRef = useRef<CloudComputerInventoryInstance[]>([]);
  const cloudOverridesRef = useRef<CloudPostActionOverrides>({});
  const [vpsInventory, setVpsInventory] = useState<VpsComputerInventoryInstance[]>([]);
  const [vpsConfigured, setVpsConfigured] = useState<boolean | null>(null);
  const [vpsAliases, setVpsAliases] = useState<string[]>([]);
  const [vpsLoading, setVpsLoading] = useState(true);
  const [vpsError, setVpsError] = useState<string | null>(null);
  const [vpsUnavailableReason, setVpsUnavailableReason] = useState<string | null>(null);
  const [vpsRemovingName, setVpsRemovingName] = useState<string | null>(null);
  const [vpsRefreshKey, setVpsRefreshKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const refreshCloudInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("cloud", signal));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.err.cloudInventory", { code: response.status }));
    const payload = body as CloudComputerInventoryPayload;
    const reconciled = reconcileCloudInventoryPayload(
      payload,
      cloudInventoryRef.current,
      cloudOverridesRef.current,
    );
    cloudOverridesRef.current = reconciled.overrides;
    cloudInventoryRef.current = reconciled.instances;
    setCloudInventory(reconciled.instances);
    setCloudConfigured(payload.configured === true);
    setCloudUnavailableReason(
      payload.available || !payload.configured
        ? null
        : (payload.problem ?? t("vm.err.cloudUnavailable")),
    );
    setCloudError(null);
  }, []);

  const refreshVpsInventory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(...computerInventoryRequest("vps", signal));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? t("vm.err.vpsInventory", { code: response.status }));
    const payload = body as VpsComputerInventoryPayload;
    setVpsInventory(Array.isArray(payload.instances) ? payload.instances : []);
    setVpsConfigured(payload.configured === true);
    setVpsAliases(Array.isArray(payload.vpsAliases) ? payload.vpsAliases : []);
    setVpsUnavailableReason(
      payload.available || !payload.configured
        ? null
        : (payload.problem ?? t("vm.err.vpsUnavailable")),
    );
    setVpsError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCloudLoading(true);
    void refreshCloudInventory(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setCloudUnavailableReason(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCloudLoading(false);
      });
    return () => controller.abort();
  }, [cloudRefreshKey, refreshCloudInventory]);

  useEffect(() => {
    const controller = new AbortController();
    setVpsLoading(true);
    void refreshVpsInventory(controller.signal)
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setVpsUnavailableReason(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setVpsLoading(false);
      });
    return () => controller.abort();
  }, [refreshVpsInventory, vpsRefreshKey]);

  const actOnCloudComputer = async (action: CloudAction, instance: CloudComputerInventoryInstance) => {
    const request = confirmComputerAction(
      cloudComputerActionPlan(action, instance),
      (message) => window.confirm(message),
    );
    if (!request) return;
    setCloudPending({ boxId: instance.boxId, action });
    setCloudError(null);
    setAnnouncement("");
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t(action === "delete" ? "vm.cloud.deleteError" : "vm.cloud.sleepError"));
      const deletionPending = action === "delete" && body?.pending === true;
      cloudOverridesRef.current = {
        ...cloudOverridesRef.current,
        [instance.boxId]: action === "delete"
          ? deletionPending ? "deleting" : "deleted"
          : "sleeping",
      };
      const reconciled = reconcileCloudInventorySnapshot(
        cloudInventoryRef.current,
        cloudInventoryRef.current,
        cloudOverridesRef.current,
      );
      cloudOverridesRef.current = reconciled.overrides;
      cloudInventoryRef.current = reconciled.instances;
      setCloudInventory(reconciled.instances);
      const subject = instance.orphaned
        ? t("vm.announce.orphanCloud")
        : t("vm.confirm.ownedCloud", { name: instance.ownerName ?? "" });
      setAnnouncement(
        deletionPending
          ? `${subject}: ${t("vm.state.removing")}.`
          : t(action === "delete" ? "vm.announce.cloudDeleted" : "vm.announce.cloudSleeping", { subject }),
      );

      if (deletionPending) {
        // Boat may accept a background operation before the computer is gone.
        for (const delayMs of PENDING_CLOUD_DELETE_REFRESH_DELAYS_MS) {
          await waitForCloudDeleteRefresh(delayMs);
          try {
            await refreshCloudInventory();
          } catch {
          }
          if (cloudOverridesRef.current[instance.boxId] !== "deleting") {
            setAnnouncement(t("vm.announce.cloudDeleted", { subject }));
            return;
          }
        }

        const nextOverrides = { ...cloudOverridesRef.current };
        delete nextOverrides[instance.boxId];
        cloudOverridesRef.current = nextOverrides;
        const restored = cloudInventoryRef.current.map((current) =>
          current.boxId === instance.boxId ? { ...current, state: instance.state } : current
        );
        cloudInventoryRef.current = restored;
        setCloudInventory(restored);
        try {
          await refreshCloudInventory();
          if (!cloudInventoryRef.current.some((current) => current.boxId === instance.boxId)) {
            setAnnouncement(t("vm.announce.cloudDeleted", { subject }));
          }
        } catch (refreshError) {
          const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
          setCloudError(`${subject}: ${t("vm.state.removing")}. ${detail}`);
        }
        return;
      }

      try {
        await refreshCloudInventory();
      } catch (refreshError) {
        const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
        setCloudError(t(action === "delete" ? "vm.cloud.deletedRefreshError" : "vm.cloud.sleepRefreshError", { subject, detail }));
      }
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloudPending(null);
    }
  };

  const removeVpsComputer = async (instance: VpsComputerInventoryInstance) => {
    const shortId = vpsComputerShortId(instance.name);
    const request = confirmComputerAction(
      vpsComputerRemovePlan(instance),
      (message) => window.confirm(message),
    );
    if (!request) return;
    setVpsRemovingName(instance.name);
    setVpsError(null);
    try {
      const response = await fetch(...request);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? t("vm.vpsRemoveError"));
      await refreshVpsInventory();
      setAnnouncement(
        t("vm.announce.vpsRemoved", {
          subject: instance.orphaned
            ? t("vm.announce.orphanVps", { id: shortId })
            : t("vm.confirm.ownedVps", { name: instance.ownerName ?? "" }),
        }),
      );
    } catch (e) {
      setVpsError(e instanceof Error ? e.message : String(e));
    } finally {
      setVpsRemovingName(null);
    }
  };

  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      <CloudComputersCard
        instances={cloudInventory}
        configured={cloudConfigured}
        loading={cloudLoading}
        pending={cloudPending}
        error={cloudError}
        unavailableReason={cloudUnavailableReason}
        onRefresh={() => setCloudRefreshKey((key) => key + 1)}
        onSleep={(instance) => void actOnCloudComputer("sleep", instance)}
        onDelete={(instance) => void actOnCloudComputer("delete", instance)}
      />

      <VpsComputersCard
        instances={vpsInventory}
        configured={vpsConfigured}
        aliases={vpsAliases}
        loading={vpsLoading}
        removingName={vpsRemovingName}
        error={vpsError}
        unavailableReason={vpsUnavailableReason}
        onRefresh={() => setVpsRefreshKey((key) => key + 1)}
        onRemove={(instance) => void removeVpsComputer(instance)}
      />

      <MacLocalControl />
    </>
  );
}
