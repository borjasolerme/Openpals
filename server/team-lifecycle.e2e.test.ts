import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("drops saved departments and migrates legacy bots and rooms through restart, keeping their conversations", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir, logPath } = fixture.info;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  let restarted: ChildProcess | undefined;
  const api = async (path: string, method = "GET", body?: unknown, status = 200) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as Record<string, any>;
    evidence.push({ path, method, body, status: response.status, result });
    expect(response.status, JSON.stringify(result)).toBe(status);
    return result;
  };
  const control = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", url]);
    evidence.push({ command: args, result });
    return result;
  };
  try {
    const a = (await control("new-bot", "--name", "Fixture researcher") as any).bot;
    const b = (await control("new-bot", "--name", "Fixture engineer") as any).bot;
    const messages = async () => (await control("messages", "--bot", a.id, "--limit", "10") as { messages: unknown[] }).messages;
    await control("send", "--bot", a.id, "--text", "Remember the original fixture conversation.");
    expect(await control("wait", "--bot", a.id, "--timeout", "30")).toMatchObject({ status: "settled" });
    const transcript = await messages();
    const room = (await control("new-channel", "--name", "Recovery room", "--members", a.id) as any).channel;
    await control("send-channel", "--channel", room.id, "--text", "Keep this group conversation through recovery.");
    expect(await control("wait", "--channel", room.id, "--timeout", "30")).toMatchObject({ status: "settled" });
    const roomMessages = (await control("messages", "--channel", room.id, "--limit", "10") as any).messages;

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const legacyBots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    const legacyGroups = JSON.parse(readFileSync(join(dataDir, "groups.json"), "utf8"));
    const chief = legacyBots.filter((bot: any) => bot.chiefOfStaff).map((bot: any) => bot.id);
    expect(chief).toHaveLength(1);
    const legacyBot = legacyBots.find((bot: any) => bot.id === a.id);
    const legacyChief = legacyBots.find((bot: any) => bot.id === b.id);
    const legacyGroup = legacyGroups.find((group: any) => group.id === room.id);
    delete legacyBot.tasks; delete legacyBot.soulHash; legacyBot.section = "Research";
    Object.assign(legacyChief, { section: "Engineering", chiefOfStaff: true, managedSections: ["Research"] });
    delete legacyGroup.tasks; delete legacyGroup.defaultResponder; legacyGroup.section = "Research";
    writeFileSync(join(dataDir, "bots.json"), JSON.stringify(legacyBots));
    writeFileSync(join(dataDir, "groups.json"), JSON.stringify(legacyGroups));

    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, {
      HOME: dataDir, USERPROFILE: dataDir, OMB_DATA_DIR: dataDir,
      APPDATA: join(dataDir, "AppData", "Roaming"), LOCALAPPDATA: join(dataDir, "AppData", "Local"),
      XDG_CONFIG_HOME: join(dataDir, ".config"), XDG_CACHE_HOME: join(dataDir, ".cache"),
      XDG_DATA_HOME: join(dataDir, ".local", "share"), HERMES_HOME: join(dataDir, ".hermes"),
      TEMP: join(dataDir, "tmp"), TMP: join(dataDir, "tmp"), TMPDIR: join(dataDir, "tmp"),
      OMB_PORT: new URL(url).port, OMB_WEBHOOK_PORT: String(Number(new URL(url).port) + 1),
      PATH: dirname(process.execPath), FAKE_CLAUDE_MODE: "happy",
    });
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      if (restarted?.exitCode !== null) throw new Error(readFileSync(logPath, "utf8"));
      return fetch(url + "/api/health").then(response => response.ok).catch(() => false);
    }, { timeout: 15_000, interval: 150 }).toBe(true);

    const recovered = await api("/api/bots?messages=0");
    const recoveredBot = recovered.bots.find((bot: any) => bot.id === a.id);
    const recoveredGroup = recovered.groups.find((group: any) => group.id === room.id);
    expect(recoveredBot).toMatchObject({ tasks: [{ threadId: a.activeTaskId }] });
    expect(recoveredGroup).toMatchObject({ defaultResponder: { kind: "member", botId: a.id } });
    expect(recovered.bots.filter((bot: any) => bot.chiefOfStaff).map((bot: any) => bot.id)).toEqual(chief);
    for (const record of [recoveredBot, recoveredGroup, recovered.bots.find((bot: any) => bot.id === b.id)]) {
      expect(record).not.toHaveProperty("section");
      expect(record).not.toHaveProperty("managedSections");
    }
    expect(recovered).not.toHaveProperty("sections");
    expect(await messages()).toEqual(transcript);
    expect((await control("messages", "--channel", room.id, "--limit", "10") as any).messages).toEqual(roomMessages);
    const savedBots = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    const savedGroups = JSON.parse(readFileSync(join(dataDir, "groups.json"), "utf8"));
    expect(savedBots.find((bot: any) => bot.id === a.id).tasks).toHaveLength(1);
    expect(savedGroups.find((group: any) => group.id === room.id).tasks).toHaveLength(1);
    for (const record of [...savedBots, ...savedGroups]) {
      expect(record).not.toHaveProperty("section");
      expect(record).not.toHaveProperty("managedSections");
    }
    expect(readFileSync(logPath, "utf8")).not.toMatch(/ReferenceError|store: change listener threw/);
    evidence.push({ legacyBotAndGroupMigrated: true, departmentsDropped: true, conversationsRetained: true });
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    const evidencePath = `${logPath}.team-lifecycle.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    expect(existsSync(dataDir)).toBe(false);
    console.info(JSON.stringify({ ...fixture.info, evidencePath, fixtureRemoved: true }));
  }
}, 60_000);
