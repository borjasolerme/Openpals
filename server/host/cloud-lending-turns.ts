// The owner test's view of a turn (server/cloud-lending.ts), read from the harness's own records. A room member turn acts
// for the person's line that started its run, for that turn generation alone, while the run lasts.
import type { CloudLendingTurn } from "../cloud-lending.ts";
import type { RoutineRun } from "../routines.ts";
import type { Store } from "../store.ts";
import type { RoomRun } from "./acting-person.ts";

type Turn = { botId: string; threadId: string; generation: string };

export interface CloudLendingTurnsDeps {
  store: Pick<Store, "groupByThread" | "messagesFor" | "taskByThread">;
  /** The one-on-one request a conversation's turns answer (index.ts directRequestOwners). */
  directRequest(threadId: string): CloudLendingTurn["request"];
  threadStarter(threadId: string): string | undefined;
  cardAnswerer: CloudLendingTurn["cardAnswerer"];
  activeRoutineRun(threadId: string): RoutineRun | null;
  ownerStartedRun(runId: string): boolean;
  routineRunIsOwners(run: RoutineRun, botId: string, threadId: string): boolean;
}

export function createCloudLendingTurns(deps: CloudLendingTurnsDeps) {
  const { store } = deps;
  /** Each room member turn's generation, while its run lasts: the harness's own record of which line started it. */
  const roomTurnOperations = new Map<string, RoomRun>();

  /** A room member turn's request: the line its run answers, for this generation alone, stopped once the run is. */
  function roomTurnRequest(generation: string): CloudLendingTurn["request"] {
    const operation = roomTurnOperations.get(generation);
    return operation?.requestMessageId ? { messageId: operation.requestMessageId, generations: new Set([generation]), stopped: operation.cancelled } : undefined;
  }

  function threadStarters(threadId: string): (string | undefined)[] {
    const room = store.groupByThread(threadId);
    return [deps.threadStarter(threadId), ...(room && room.threadId !== threadId ? [deps.threadStarter(room.threadId)] : [])];
  }

  function cloudLendingTurn(capability: Turn): Omit<CloudLendingTurn, "ownerPerson"> {
    return {
      request: store.groupByThread(capability.threadId) ? roomTurnRequest(capability.generation) : deps.directRequest(capability.threadId),
      generation: capability.generation,
      thread: store.messagesFor(capability.threadId),
      starters: threadStarters(capability.threadId),
      cardAnswerer: deps.cardAnswerer,
      routineRun: () => {
        const run = deps.activeRoutineRun(capability.threadId);
        if (!run || run.threadId !== capability.threadId || store.taskByThread(capability.botId, capability.threadId)?.routineRunId !== run.id) return null;
        return {
          triggerSource: run.triggerSource ?? (run.manual ? "manual" : "schedule"),
          ownerStarted: deps.ownerStartedRun(run.id),
          ownerAuthored: deps.routineRunIsOwners(run, capability.botId, capability.threadId),
        };
      },
    };
  }

  return {
    cloudLendingTurn,
    /** A room member turn of this run started: its generation acts for the line the run answers. */
    roomTurnStarted(generation: string, run: RoomRun): void { roomTurnOperations.set(generation, run); },
    /** The run ended: none of its turn generations act for anyone any more. */
    roomTurnEnded(run: RoomRun): void { for (const [generation, owner] of roomTurnOperations) if (owner === run) roomTurnOperations.delete(generation); },
    /** The run a room member turn generation belongs to, while it lasts (server/host/acting-person.ts reads whom it acts for). */
    roomRun: (generation: string): RoomRun | undefined => roomTurnOperations.get(generation),
  };
}
