import { describe, expect, it } from "vitest";
import { LENT_FILES_TOOL, lentComputerRpc, type LentComputerRpcDeps } from "./lent-computer-tools.ts";

const MINE = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function deps(sent: unknown[], confirm = async () => {}): LentComputerRpcDeps {
  return {
    computerId: MINE,
    lends: () => ({ name: "Mac mini", computer: false, terminal: false, folders: [{ id: FOLDER, name: "Projects", write: true }] }),
    away: () => "away",
    request: async (operation) => { sent.push(operation); return { content: [{ type: "text", text: "ok" }] }; },
    gate: async () => ({ held: false }),
    confirm,
    assertActive: () => {},
  };
}

describe("a bot's calls on a lent computer", () => {
  it("reach only this turn's computer and folder, whatever the bot passes", async () => {
    const sent: unknown[] = [];
    await lentComputerRpc({ method: "tools/call", params: { name: LENT_FILES_TOOL, arguments: { action: "read", folder: "Projects", path: "a.txt", computer_id: OTHER, folder_id: OTHER } } }, deps(sent));
    expect(sent).toEqual([{ computer_id: MINE, action: "read_file", folder_id: FOLDER, path: "a.txt" }]);
  });

  it("asks before changing a file, and changes nothing when the person says no", async () => {
    const sent: unknown[] = [];
    const answer = await lentComputerRpc({ method: "tools/call", params: { name: LENT_FILES_TOOL, arguments: { action: "write", folder: "Projects", path: "a.txt", content: "x" } } },
      deps(sent, async () => { throw new Error("the person said no"); })) as { isError?: boolean };
    expect(answer.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it("lists the folders tool only for what it lends, and nothing while it is away", async () => {
    const listed = await lentComputerRpc({ method: "tools/list" }, deps([])) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual([LENT_FILES_TOOL]);
    const away = await lentComputerRpc({ method: "tools/list" }, { ...deps([]), lends: () => null });
    expect(away).toEqual({ tools: [] });
  });
});
