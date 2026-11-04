import { describe, expect, it } from "vitest";
import { parseChatLink } from "./chat-links";

describe("parseChatLink", () => {
  const uuid = "8b1b1d62-9d3c-4a1e-9f2a-3c5d7e9b1a04";

  it("reads a thread link with or without its owner, and a bot link", () => {
    expect(parseChatLink(`openmausbot://thread/${uuid}?bot=scout`)).toEqual({ threadId: uuid, botId: "scout" });
    expect(parseChatLink(`  openmausbot://thread/${uuid}  `)).toEqual({ threadId: uuid });
    expect(parseChatLink("openmausbot://bot/scout")).toEqual({ botId: "scout" });
    expect(parseChatLink("OpenMausBot://bot/scout%20two")).toEqual({ botId: "scout two" });
  });

  it("rejects near-misses", () => {
    for (const miss of [
      `openmausbot://thread/${uuid}/extra?bot=scout`,
      `openmausbot://thread/${uuid}?bot=scout&x=1`,
      `openmausbot://thread/${uuid}?bot=`,
      `openmausbot://thread/${uuid}#top`,
      `omb://thread/${uuid}?bot=scout`,
      `https://thread/${uuid}`,
      "openmausbot://bot/scout/extra",
      "openmausbot://bot/scout?x=1",
      "openmausbot://bots/scout",
      "openmausbot://bot/",
      "openmausbot://bot/%E0%A4%A",
      `openmausbot://bot/${"x".repeat(257)}`,
      "not a link",
    ]) {
      expect(parseChatLink(miss), miss).toBeNull();
    }
  });
});
