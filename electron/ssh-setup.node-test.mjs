import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { lastLines, pairingLinkIn, scrubbed } from "./server-setup.mjs";
import { setupOverSsh, sshAddress } from "./ssh-setup.mjs";

const LINK = "https://203-0-113-7.sslip.io/pair#code=ABCD-EFGH-JKLM";
const SCRIPT = "#!/usr/bin/env bash\necho installer\n";

/** A fake `ssh` that prints `stdout`/`stderr` and exits with `code` once the installer arrived on its stdin. */
function fakeSsh({ stdout = "", stderr = "", code = 0, error = null, hang = false }) {
  const spawned = [];
  const spawn = (file, args) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
    child.kill = () => { child.killed = true; };
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk; });
    child.stdin.on("finish", () => {
      spawned.push({ file, args, input });
      if (error) return void child.emit("error", error);
      if (hang) return;
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      setImmediate(() => child.emit("close", code));
    });
    return child;
  };
  return { spawn, spawned };
}

test("runs the installer over ssh with this computer's key and returns the pairing link", async () => {
  const ssh = fakeSsh({ stdout: `==> Installing Caddy for HTTPS\npairing code:  ABCD-EFGH-JKLM\nOPENPALS_PAIRING_LINK=${LINK}\n` });
  const progress = [];
  const result = await setupOverSsh({ address: " root@203.0.113.7 ", script: SCRIPT, spawn: ssh.spawn, onProgress: (step) => progress.push(step) });
  assert.deepEqual(result, { ok: true, link: LINK });
  assert.equal(ssh.spawned[0].file, "ssh");
  assert.deepEqual(ssh.spawned[0].args.slice(0, 4), ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]);
  assert.deepEqual(ssh.spawned[0].args.slice(-2), ["root@203.0.113.7", "bash -s --"]);
  assert.equal(ssh.spawned[0].input, SCRIPT);
  assert.deepEqual(progress, [{ step: "installing" }, { step: "installing", detail: "Installing Caddy for HTTPS" }]);
});

test("refuses anything but user@address before running ssh", async () => {
  for (const bad of ["", "203.0.113.7", "-oProxyCommand=evil@host", "root@-oProxyCommand=x", "root@host name", "root@host;rm"]) {
    assert.equal(sshAddress(bad), null, bad);
    const ssh = fakeSsh({});
    assert.deepEqual(await setupOverSsh({ address: bad, script: SCRIPT, spawn: ssh.spawn }), { ok: false, error: { code: "ssh-address" } });
    assert.equal(ssh.spawned.length, 0);
  }
  assert.equal(sshAddress("ubuntu@bots.example.com"), "ubuntu@bots.example.com");
});

test("names why ssh couldn't sign in or reach the server", async () => {
  for (const [stderr, code] of [
    ["root@203.0.113.7: Permission denied (publickey).", "ssh-key"],
    ["ssh: connect to host 203.0.113.7 port 22: Connection refused", "ssh-unreachable"],
    ["ssh: Could not resolve hostname nowhere: nodename nor servname provided", "ssh-unreachable"],
    ["@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.", "ssh-host-key"],
  ]) {
    const ssh = fakeSsh({ stderr, code: 255 });
    assert.deepEqual(await setupOverSsh({ address: "root@203.0.113.7", script: SCRIPT, spawn: ssh.spawn }), { ok: false, error: { code } }, stderr);
  }
  const missing = fakeSsh({ error: Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" }) });
  assert.deepEqual(await setupOverSsh({ address: "root@h", script: SCRIPT, spawn: missing.spawn }), { ok: false, error: { code: "ssh-missing" } });
});

test("a server that isn't Ubuntu or Debian says so; any other failure shows the last lines, scrubbed", async () => {
  const fedora = fakeSsh({ stderr: "\nError: this installer needs Ubuntu or Debian (apt-get was not found)\n", code: 1 });
  assert.deepEqual(await setupOverSsh({ address: "root@h", script: SCRIPT, spawn: fedora.spawn }), { ok: false, error: { code: "unsupported" } });

  const broken = fakeSsh({ stdout: `open or scan:  ${LINK}\n`, stderr: "Error: Openpals did not start.\n", code: 1 });
  const result = await setupOverSsh({ address: "root@h", script: SCRIPT, spawn: broken.spawn });
  assert.equal(result.error.code, "install-failed");
  assert.match(result.error.output, /did not start/);
  assert.ok(!result.error.output.includes("ABCD"));
});

test("an installer that never ends times out and is stopped", async () => {
  const ssh = fakeSsh({ hang: true });
  const result = await setupOverSsh({ address: "root@h", script: SCRIPT, spawn: ssh.spawn, timeoutMs: 5 });
  assert.deepEqual(result, { ok: false, error: { code: "timeout" } });
});

test("the pairing link is read from its own line only, and never shown", () => {
  assert.equal(pairingLinkIn(`noise\nOPENPALS_PAIRING_LINK=${LINK}\r\nmore`), LINK);
  assert.equal(pairingLinkIn(`open or scan:  ${LINK}`), null);
  assert.equal(pairingLinkIn("OPENPALS_PAIRING_LINK=http://plain/pair#code=X"), null);
  const shown = scrubbed(`pairing code:  ABCD-EFGH-JKLM\nopen or scan:  ${LINK}\n▄▄▄▄▄ █▀█ ▄▄▄▄▄\n█   █ ▄▀█ █   █\nOPENPALS_PAIRING_LINK=${LINK}\nNext: paste it`);
  assert.equal(shown, "open or scan:  https://203-0-113-7.sslip.io/pair#code=…\nNext: paste it");
  assert.equal(lastLines(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")).split("\n")[0], "line 18");
});
