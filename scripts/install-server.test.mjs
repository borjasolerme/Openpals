import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "install-server.sh");
const run = (...args) => spawnSync("bash", [script, ...args], { encoding: "utf8" });
const shellcheck = spawnSync("shellcheck", ["--version"]).status === 0;

describe("the server installer", () => {
  it("is valid bash", () => {
    expect(spawnSync("bash", ["-n", script], { encoding: "utf8" }).stderr).toBe("");
  });

  it.skipIf(!shellcheck)("passes shellcheck", () => {
    const result = spawnSync("shellcheck", [script], { encoding: "utf8" });
    expect(result.stdout).toBe("");
  });

  it("prints its usage", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--public-url");
  });

  it("prints the pairing link on its own line for the app, and sets up HTTPS itself without --public-url", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("printf 'OPENPALS_PAIRING_LINK=%s\\n' \"$link\"");
    expect(run("--help").stdout).toContain("https://<public-ip>.sslip.io");
  });

  it.each([
    [["--public-url", "http://bots.example.com"], "must be an HTTPS address"],
    [["--public-url", "https://bots.example.com/pair"], "must be an HTTPS address"],
    [["--public-url", "https://bots.example.com", "--label", "a;rm -rf /"], "--label may use"],
    [["--public-url", "https://bots.example.com", "--port", "1"], "unknown option: --port"],
  ])("refuses %j before changing anything", (args, message) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
