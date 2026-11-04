import { afterEach, describe, expect, it } from "vitest";

import { forgetPresence, onThreadSeen, personAsks, sawThread } from "./thread-presence.ts";

afterEach(() => forgetPresence());

describe("thread presence", () => {
  it("tells listeners when a person opens or reads a conversation, but not when they ask in it", () => {
    const heard: string[] = [];
    const stop = onThreadSeen((threadId) => heard.push(threadId));
    sawThread("opened");
    personAsks.set("asked", 2_000);
    expect(heard).toEqual(["opened"]);
    stop();
    sawThread("later");
    expect(heard).toEqual(["opened"]);
  });

  it("keeps going when a listener throws", () => {
    const heard: string[] = [];
    const stopFailing = onThreadSeen(() => { throw new Error("listener failed"); });
    const stop = onThreadSeen((threadId) => heard.push(threadId));
    expect(() => sawThread("t")).not.toThrow();
    expect(heard).toEqual(["t"]);
    stopFailing();
    stop();
  });
});
