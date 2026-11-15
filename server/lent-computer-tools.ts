// Served at POST /api/internal/computer/mcp for a turn whose bot works on a computer its owner lends to this server
// (a Mac mini, a laptop): that computer's own screen tools, plus its terminal and folders when its owner lends them.
// Each call reaches the computer as one job, and the computer checks it again against what its owner lends there.
import { controlRefusal, type ControlState } from "./control-client.ts";
import { lentScreenResult } from "./lent-screen-guidance.ts";
import type { SharedComputerOperation } from "./shared-computers.ts";

export const LENT_COMMAND_TOOL = "run_command";
export const LENT_FILES_TOOL = "folder_files";
const COMMAND_SECONDS_MAX = 900;

/** What the computer lends right now; null while it is offline or paused. */
export interface LentNow {
  name: string;
  computer: boolean;
  terminal: boolean;
  folders: ReadonlyArray<{ id: string; name: string; write: boolean }>;
}

type ToolResult = { content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean };
type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export interface LentComputerRpcDeps {
  computerId: string;
  lends(): LentNow | null;
  /** Why it can't be used now (offline since, paused), for a bot that calls while it is away. */
  away(): string;
  request(operation: SharedComputerOperation): Promise<unknown>;
  /** The person's hold and this turn's claim of the screen, as on every other computer. */
  gate(): Promise<Pick<ControlState, "held" | "reason" | "blockedReason">>;
  /** Asks the person before a command or a change to their files; throws when they say no. */
  confirm(kind: "terminal" | "files"): Promise<void>;
  assertActive(): void;
}

const text = (value: string, isError = false): ToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

function commandTool(name: string): Tool {
  return {
    name: LENT_COMMAND_TOOL,
    description: `Run a shell command on ${name}, the person's own computer, as them, and wait for its output (at most ${COMMAND_SECONDS_MAX} seconds). It starts in the first folder they lend, or their home folder. Openpals asks the person before the first command in a request unless the bot has full access.`,
    inputSchema: {
      type: "object", additionalProperties: false, required: ["command"],
      properties: {
        command: { type: "string", minLength: 1, maxLength: 8000 },
        timeout_seconds: { type: "integer", minimum: 1, maximum: COMMAND_SECONDS_MAX, description: "Stop the command after this many seconds (default 120)." },
      },
    },
  };
}

function filesTool(name: string, folders: LentNow["folders"]): Tool {
  const listed = folders.map((folder) => `"${folder.name}"${folder.write ? "" : " (read only)"}`).join(", ");
  return {
    name: LENT_FILES_TOOL,
    description: `Read and change files in the folders the person lends from ${name}: ${listed}. Paths are relative to the folder. Read a file before changing it and pass its sha256 as expected_sha256 to overwrite or delete it. Openpals asks the person before the first change in a request unless the bot has full access.`,
    inputSchema: {
      type: "object", additionalProperties: false, required: ["action", "folder"],
      properties: {
        action: { type: "string", enum: ["list", "read", "write", "edit", "append", "delete"] },
        folder: { type: "string", enum: folders.map((folder) => folder.name) },
        path: { type: "string", maxLength: 2048 },
        content: { type: "string", maxLength: 350_000 },
        encoding: { type: "string", enum: ["utf8", "base64"] },
        old_text: { type: "string", maxLength: 350_000 },
        new_text: { type: "string", maxLength: 350_000 },
        expected_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
  };
}

const FILE_ACTIONS = { list: "list_files", read: "read_file", write: "write_file", edit: "edit_file", append: "append_file", delete: "delete_file" } as const;

/** The screen tools the computer lists, as its desktop filtered them, from a computer_tools answer. */
export function listedScreenTools(answer: unknown): Tool[] {
  const content = (answer as ToolResult | null)?.content;
  const first = Array.isArray(content) ? content.find((part) => part?.type === "text") : undefined;
  if (typeof first?.text !== "string") return [];
  try {
    const tools = (JSON.parse(first.text) as { tools?: unknown }).tools;
    return Array.isArray(tools)
      ? tools.filter((tool): tool is Tool => typeof tool?.name === "string" && tool.name !== LENT_COMMAND_TOOL && tool.name !== LENT_FILES_TOOL && Boolean(tool.inputSchema))
      : [];
  } catch {
    return [];
  }
}

async function asResult(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const value = await run();
    return value && typeof value === "object" && Array.isArray((value as ToolResult).content) ? value as ToolResult : text(JSON.stringify(value));
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
}

async function callFiles(deps: LentComputerRpcDeps, now: LentNow, args: Record<string, unknown>): Promise<ToolResult> {
  const folder = now.folders.find((entry) => entry.name === args.folder);
  const action = FILE_ACTIONS[args.action as keyof typeof FILE_ACTIONS];
  if (!folder || !action) return text(`Give action and one of the lent folders: ${now.folders.map((entry) => entry.name).join(", ")}.`, true);
  if (action !== "list_files" && action !== "read_file") await deps.confirm("files");
  const { folder: _folder, action: _action, ...rest } = args;
  deps.assertActive();
  return asResult(() => deps.request({ computer_id: deps.computerId, action, folder_id: folder.id, ...rest } as SharedComputerOperation));
}

/** Listing asks the computer for its screen tools; calls go through the turn's gate first, as on every computer. */
export async function lentComputerRpc(
  request: { method?: unknown; params?: unknown } | null | undefined,
  deps: LentComputerRpcDeps,
): Promise<{ tools: Tool[] } | ToolResult> {
  if (request?.method === "tools/list") {
    deps.assertActive();
    const now = deps.lends();
    if (!now) return { tools: [] };
    const screen = now.computer
      ? listedScreenTools(lentScreenResult({ action: "computer_tools" }, await deps.request({ computer_id: deps.computerId, action: "computer_tools" }).catch(() => null)))
      : [];
    return { tools: [...screen, ...(now.terminal ? [commandTool(now.name)] : []), ...(now.folders.length ? [filesTool(now.name, now.folders)] : [])] };
  }
  if (request?.method !== "tools/call") throw Object.assign(new Error("unsupported computer method"), { status: 400 });
  const params = (request.params && typeof request.params === "object" ? request.params : {}) as { name?: unknown; arguments?: unknown };
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
  const now = deps.lends();
  if (!now) return text(deps.away(), true);
  const control = await deps.gate();
  if (control.held) return text(controlRefusal(control), true);
  deps.assertActive();
  try {
    if (name === LENT_COMMAND_TOOL) {
      if (typeof args.command !== "string" || !args.command.trim()) return text("Give the command to run.", true);
      await deps.confirm("terminal");
      deps.assertActive();
      return await asResult(() => deps.request({
        computer_id: deps.computerId, action: "run_command", command: args.command as string,
        ...(Number.isInteger(args.timeout_seconds) ? { timeout_seconds: args.timeout_seconds as number } : {}),
      }));
    }
    if (name === LENT_FILES_TOOL) return await callFiles(deps, now, args);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
  const operation = { computer_id: deps.computerId, action: "computer_call" as const, tool_name: name, arguments: args };
  const result = await asResult(() => deps.request(operation));
  deps.assertActive();
  return lentScreenResult(operation, result) as ToolResult;
}
