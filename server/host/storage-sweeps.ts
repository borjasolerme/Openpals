// The disk's three timed sweeps, started together once the server answers: the conversation logs' cap and age limit
// (thread-log-sweep.ts), the full tool results' day-old sweep (tool-results-sweep.ts), and ended engine sessions
// (engine-session-sweep.ts). Each is on unless its variable says `off` (or `report`, which only counts); upstream runs
// them only on a Cloud home, Openpals on every server, where a full disk is the problem they solve.
//
// Openpals has no move freeze: a pass pauses only while a workspace backup or restore holds the server.
import { join } from "node:path";

import type { InstanceConfig } from "../contracts.ts";
import { engineSessionFolders, instanceEnvironment } from "./engine-session-folders.ts";
import { startEngineSessionSweep, type SessionHolder } from "./engine-session-sweep.ts";
import { knownThreads, startThreadLogSweep } from "./thread-log-sweep.ts";
import { startToolResultsSweep } from "./tool-results-sweep.ts";

type Thread = { threadId: string };
type Bot = Omit<SessionHolder, "tasks"> & { id: string; threadId?: string; tasks?: ReadonlyArray<Thread & NonNullable<SessionHolder["tasks"]>[number]> };

export interface StorageSweepsDeps {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  bots(): ReadonlyArray<Bot>;
  groups(): ReadonlyArray<{ threadId?: string; tasks?: ReadonlyArray<Thread> }>;
  /** Every engine instance this server runs: its environment, and a Claude account's own folder. */
  instances(): Iterable<Pick<InstanceConfig, "driver" | "environment" | "config">>;
  threadBusy(botId: string, threadId: string): boolean;
  handedOff(threadId: string): boolean;
  /** A workspace backup or restore holds the server. */
  paused(): boolean;
  /** Any turn running anywhere on this server: bots, rooms, routines. */
  turnsRunning(): boolean;
  /** The event bus has nothing queued or being written for this conversation's log. */
  logQuiet(threadId: string): boolean;
}

/** Which of the three started: each is on unless its variable turns it off. */
export interface StartedSweeps { threadLogs: boolean; toolResults: boolean; engineSessions: boolean }

/** The environments an engine of this server runs with. Only a Claude instance's configDir is a Claude folder; any
 * other engine's instance adds just its environment. */
export function engineEnvironments(env: NodeJS.ProcessEnv, instances: Iterable<Pick<InstanceConfig, "driver" | "environment" | "config">>): Array<Record<string, string | undefined>> {
  return [env, ...[...instances].map((instance) => instanceEnvironment(env, instance.driver === "claudeAgent" ? instance : { environment: instance.environment }))];
}

export function startStorageSweeps(deps: StorageSweepsDeps): StartedSweeps {
  const { env, dataDir, paused, turnsRunning } = deps;
  const threadLogs = startThreadLogSweep({
    env, dataDir, paused, turnsRunning, logQuiet: deps.logQuiet,
    threads: () => knownThreads(deps.bots(), deps.groups(), (botId, threadId) => deps.threadBusy(botId, threadId) || deps.handedOff(threadId)),
  });
  const toolResults = startToolResultsSweep({ env, dataDir, root: join(dataDir, "tool-results"), paused, turnsRunning });
  const environments = () => engineEnvironments(env, deps.instances());
  const engineSessions = startEngineSessionSweep({ env, dataDir, bots: deps.bots, folders: () => engineSessionFolders(dataDir, environments()), environments, paused, turnsRunning });
  return { threadLogs, toolResults, engineSessions };
}
