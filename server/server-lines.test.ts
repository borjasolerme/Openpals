import { describe, expect, it } from "vitest";

import "./server-line-packs.ts";
import { serverLine } from "./server-lines.ts";

describe("serverLine", () => {
  it("writes the line in the language given, with its values filled in", () => {
    expect(serverLine("de", "server.mcp.added", { name: "github" })).toBe("MCP-Server github hinzugefügt");
    expect(serverLine(undefined, "server.mcp.added", { name: "github" })).toBe("Added MCP server github");
    expect(serverLine("en", "server.mcp.testTools.many", { count: 5 })).toBe("Test: 5 tools");
  });

  it("reads a regional tag as its language, and a language it has no words for as English", () => {
    expect(serverLine("de-AT", "server.mcp.listed")).toBe("MCP-Server geprüft");
    expect(serverLine("pt", "server.mcp.listed")).toBe(serverLine("pt-br", "server.mcp.listed"));
    expect(serverLine("zh-Hant", "server.mcp.listed")).toBe(serverLine("zh-tw", "server.mcp.listed"));
    expect(serverLine("nl", "server.mcp.listed")).toBe("Checked MCP servers");
  });

  it("leaves a {name} it was given no value for as it is", () => {
    expect(serverLine("en", "server.teammates.sendFailed", {})).toBe("Send failed — {detail}");
  });
});
