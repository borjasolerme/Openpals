import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { expect, it } from "vitest";
import { superviseServer } from "./server-launcher.ts";

function fakeChild(pid: number) {
  const child = Object.assign(new EventEmitter(), { pid, killed: [] as string[], exitCode: null as number | null,
    kill(signal: string) { child.killed.push(signal); return true; } });
  return child;
}

it("the container launcher passes SIGTERM on and exits with the server's code", async () => {
  const signals = new EventEmitter();
  const child = fakeChild(1);
  const done = superviseServer(() => child as unknown as ChildProcess, { signals: signals as unknown as NodeJS.Process });
  // `docker stop`: the launcher passes it on, and the server's own exit decides.
  signals.emit("SIGTERM");
  expect(child.killed).toEqual(["SIGTERM"]);
  child.emit("exit", 0, null);
  expect(await done).toBe(0);
  expect(signals.listenerCount("SIGTERM")).toBe(0);
});

it("the container launcher passes a failed exit through, and a signal death counts as a failure unless it was stopping", async () => {
  const signals = new EventEmitter();
  let child = fakeChild(1);
  const failed = superviseServer(() => child as unknown as ChildProcess, { signals: signals as unknown as NodeJS.Process });
  child.emit("exit", 1, null);
  expect(await failed).toBe(1);
  child = fakeChild(2);
  const killed = superviseServer(() => child as unknown as ChildProcess, { signals: signals as unknown as NodeJS.Process });
  child.emit("exit", null, "SIGKILL");
  expect(await killed).toBe(1);
  child = fakeChild(3);
  const stopped = superviseServer(() => child as unknown as ChildProcess, { signals: signals as unknown as NodeJS.Process });
  signals.emit("SIGINT");
  child.emit("exit", null, "SIGINT");
  expect(await stopped).toBe(0);
});
