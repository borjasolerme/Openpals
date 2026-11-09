import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { readMembership, type Membership } from "../lib/membership";
import { readSessionState, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { Card, SettingRow } from "./SettingsPrimitives";

export type Role = "admin" | "member";

export interface SignInLists {
  admins: string[];
  members: string[];
}

export function withEntry(lists: SignInLists, entry: string, role: Role): SignInLists {
  const admins = lists.admins.filter((item) => item !== entry);
  const members = lists.members.filter((item) => item !== entry);
  return role === "admin" ? { admins: [...admins, entry], members } : { admins, members: [...members, entry] };
}

export function withoutEntry(lists: SignInLists, entry: string): SignInLists {
  return { admins: lists.admins.filter((item) => item !== entry), members: lists.members.filter((item) => item !== entry) };
}


export interface Person {
  entry: string;
  role: Role;
  isDomain: boolean;
  lastSeenAt: number | null;
  devices: number;
  turns: number;
  costUsd: number | null;
  estimated?: boolean;
}

export function mergePeople(
  lists: SignInLists,
  sessions: Array<{ email?: string; lastSeenAt: number }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null; estimatedUsd?: number | null }>,
): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();
  const add = (entry: string, role: Role) => {
    const key = entry.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const devices = sessions.filter((session) => session.email?.toLowerCase() === key);
    const month = usage.find((group) => group.key === `user:${key}`);
    people.push({
      entry: key,
      role,
      isDomain: key.startsWith("@"),
      lastSeenAt: devices.length ? Math.max(...devices.map((session) => session.lastSeenAt)) : null,
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
      ...(hasFiniteCost(month?.estimatedUsd) && month.estimatedUsd > 0 ? { estimated: true } : {}),
    });
  };
  for (const entry of lists.admins) add(entry, "admin");
  for (const entry of lists.members) add(entry, "member");
  return people;
}

export function peopleFromSessions(
  sessions: Array<{ email?: string; lastSeenAt: number; scopes?: string[] }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null }>,
): Person[] {
  const byEmail = new Map<string, Array<{ lastSeenAt: number; scopes?: string[] }>>();
  for (const session of sessions) {
    const email = session.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), session]);
  }
  return [...byEmail.entries()].map(([entry, devices]) => {
    const month = usage.find((group) => group.key === `user:${entry}`);
    return {
      entry,
      role: devices.some((device) => device.scopes?.includes("admin")) ? "admin" : "member",
      isDomain: false,
      lastSeenAt: Math.max(...devices.map((device) => device.lastSeenAt)),
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
    } satisfies Person;
  }).sort((a, b) => (a.role === b.role ? a.entry.localeCompare(b.entry) : a.role === "admin" ? -1 : 1));
}

export function lastSeenLabel(lastSeenAt: number | null, now = Date.now()): string {
  if (lastSeenAt === null) return t("people.never");
  if (now - lastSeenAt < 24 * 60 * 60_000) return t("people.today");
  return new Date(lastSeenAt).toISOString().slice(0, 10);
}

export function PeopleTable({ people, busy, onRole, onRemove, readOnly = false }: {
  people: Person[];
  busy: boolean;
  onRole: (person: Person, role: Role) => void;
  onRemove: (person: Person) => void;
  readOnly?: boolean;
}) {
  if (people.length === 0) return <p className="text-base text-ink-secondary">{t(readOnly ? "people.portal.empty" : "people.empty")}</p>;
  const columns = "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4";
  return (
    <div className="flex flex-col">
      <div className={cn(columns, "border-b border-hairline/40 pb-2 text-sm font-medium uppercase tracking-wide text-ink-secondary")}>
        <span>{t("people.colPerson")}</span>
        <span>{t("people.colRole")}</span>
        <span className="text-right">{t("people.colLastSeen")}</span>
        <span className="text-right">{t("people.colMonth")}</span>
        <span />
      </div>
      {people.map((person) => (
        <div key={person.entry} className={cn(columns, "border-b border-hairline/20 py-2 text-base")}>
          <span className="min-w-0">
            <span className="block truncate text-ink">{person.isDomain ? t("people.everyoneAt", { domain: person.entry.slice(1) }) : person.entry}</span>
            {person.devices > 0 && <span className="block text-sm text-ink-secondary">{t("people.devices", { count: String(person.devices) })}</span>}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", person.role === "admin" ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}>
            {person.role === "admin" ? t("people.roleAdmin") : t("people.roleMember")}
          </span>
          <span className="text-right tabular-nums text-ink-secondary">{person.isDomain ? "—" : lastSeenLabel(person.lastSeenAt)}</span>
          <span className="text-right tabular-nums text-ink" title={t("people.turns", { turns: String(person.turns) })}>
            {hasFiniteCost(person.costUsd) ? `${person.estimated ? "~" : ""}${formatUsd(person.costUsd)}` : "—"}
          </span>
          {readOnly ? <span /> : <span className="flex items-center justify-end gap-2 text-sm">
            <button type="button" disabled={busy} onClick={() => onRole(person, person.role === "admin" ? "member" : "admin")} className="text-ink-secondary hover:text-ink disabled:opacity-50">
              {person.role === "admin" ? t("people.makeMember") : t("people.makeAdmin")}
            </button>
            <button type="button" disabled={busy} onClick={() => onRemove(person)} className="text-danger hover:underline disabled:opacity-50">{t("people.remove")}</button>
          </span>}
        </div>
      ))}
    </div>
  );
}

export function PortalPeople({ peopleUrl, people }: { peopleUrl: string | null; people: Person[] }) {
  const noop = () => {};
  return (
    <Card title={t("people.title")} subtitle={t("people.portal.subtitle")}>
      <div data-people-portal className="flex flex-col gap-3 text-base leading-relaxed text-ink-secondary">
        <p>{t("people.portal.managed")}</p>
        {peopleUrl && (
          <a
            href={peopleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-2 rounded-lg bg-control px-3 py-2 font-medium text-ink hover:bg-control/70"
          >
            {t("people.portal.open")} <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="mt-4">
        <PeopleTable people={people} busy={false} readOnly onRole={noop} onRemove={noop} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{t("people.portal.note")}</p>
    </Card>
  );
}

export function PeopleSection({ simple = false, startOpen = false }: { simple?: boolean; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [session, setSession] = useState<SessionState | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [lists, setLists] = useState<SignInLists | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, sessions, usage] = await Promise.all([
        api("/api/config"),
        api("/api/auth/sessions").catch(() => ({ sessions: [] })),
        api("/api/usage?groupBy=user").catch(() => ({ groups: [] })),
      ]);
      const current: SignInLists = {
        admins: Array.isArray(config?.signIn?.admins) ? config.signIn.admins : [],
        members: Array.isArray(config?.signIn?.members) ? config.signIn.members : [],
      };
      const authority = readMembership(config);
      setMembership(authority);
      setLists(current);
      const signedIn = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      const spent = Array.isArray(usage?.groups) ? usage.groups : [];
      setPeople(authority.authority === "portal" ? peopleFromSessions(signedIn, spent) : mergePeople(current, signedIn, spent));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void readSessionState().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  const save = async (next: SignInLists) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ signIn: next }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!canPairDevices(session)) return null;
  const portal = membership?.authority === "portal" ? <PortalPeople peopleUrl={membership.peopleUrl} people={people} /> : null;
  const content = (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} disabled={loading || busy} aria-label={t("people.refresh")} title={t("people.refresh")} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"><RefreshCw size={13} className={cn(loading && "animate-spin")} /></button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-4">
        <PeopleTable
          people={people}
          busy={busy}
          onRole={(person, next) => { if (lists) void save(withEntry(lists, person.entry, next)); }}
          onRemove={(person) => { if (lists) void save(withoutEntry(lists, person.entry)); }}
        />
      </div>
      {!simple && <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{t("people.note")}</p>}
    </>
  );
  if (simple) {
    return (
      <div data-people-summary="">
        <SettingRow title={t("people.title")} subtitle={t("settings.simple.people")}>
          <button type="button" aria-expanded={open} className="ui-button" onClick={() => setOpen(!open)}>
            {open ? t("common.done") : t("settings.simple.people.manage")}
          </button>
        </SettingRow>
        {open && <div className="px-3.5 pb-3.5 pt-1">{portal ?? content}</div>}
      </div>
    );
  }
  return portal ?? <Card title={t("people.title")} subtitle={t("people.subtitle")}>{content}</Card>;
}
