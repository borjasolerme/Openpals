// Where the engines this server runs keep their sessions, and the one path rule every sweep of those folders follows.
// Upstream keeps these in delete-leftovers.ts; Openpals has no delete leftovers, so the engine sessions' sweep
// (engine-session-sweep.ts) takes them from here.
import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface EngineSessionFolders {
  claude: readonly string[];
  codex: readonly string[];
}

function realFolder(path: string): boolean {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function entries(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/** Whether `path` is inside `root` with every folder between them a real folder. */
export function plainlyUnder(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  const parts = rel.split(sep);
  let at = resolve(root);
  for (const part of parts.slice(0, -1)) {
    at = join(at, part);
    if (!realFolder(at)) return false;
  }
  return true;
}

/** Where each engine keeps its sessions, for every environment an engine of this server runs with. */
export function engineSessionFolders(dataDir: string, environments: Iterable<Record<string, string | undefined>>): EngineSessionFolders {
  const claude = new Set<string>(), codex = new Set<string>();
  const absolute = (value: string | undefined) => (value && isAbsolute(value) ? resolve(value) : null);
  for (const env of environments) {
    const home = absolute(env.HOME) ?? absolute(env.USERPROFILE);
    const claudeFolder = absolute(env.CLAUDE_CONFIG_DIR) ?? (home && join(home, ".claude"));
    const codexFolder = absolute(env.CODEX_HOME) ?? (home && join(home, ".codex"));
    if (claudeFolder) claude.add(claudeFolder);
    if (codexFolder) codex.add(codexFolder);
  }
  // Openpals' own Codex homes for a ChatGPT plan's sign-in (drivers/codex.ts): providers/chatgpt-plan/<hash>/codex.
  const plans = join(resolve(dataDir), "providers", "chatgpt-plan");
  for (const home of entries(plans)) codex.add(join(plans, home, "codex"));
  return { claude: [...claude], codex: [...codex] };
}

/** An instance's environment as its engine is started with it: the server's, the instance's own over it, and a Claude
 * account's folder (`config.configDir`, absolute or under `~/`) as CLAUDE_CONFIG_DIR. */
export function instanceEnvironment(base: Record<string, string | undefined>, instance: { environment?: Record<string, string>; config?: unknown }): Record<string, string | undefined> {
  const env = { ...base, ...instance.environment };
  const configDir = (instance.config as { configDir?: unknown } | null | undefined)?.configDir;
  const home = env.HOME ?? env.USERPROFILE;
  if (typeof configDir !== "string" || !configDir.trim()) return env;
  const named = configDir.trim();
  const folder = named === "~" ? home : named.startsWith("~/") && home ? join(home, named.slice(2)) : named;
  return folder && isAbsolute(folder) ? { ...env, CLAUDE_CONFIG_DIR: folder } : env;
}
