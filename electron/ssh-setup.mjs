// Sets up an always-on Openpals server on the person's own Linux server over the system `ssh`, signed in with this
// computer's SSH key. The installer's text goes in on stdin, so the server needs nothing but bash to start.
import { spawn as spawnProcess } from "node:child_process";
import { appendOutput, createStepReader, lastLines, pairingLinkIn } from "./server-setup.mjs";

const SSH_FAILED = 255;
const INSTALL_TIMEOUT_MS = 40 * 60_000;
// A user, then a host name, IPv4 or IPv6 address. Never a leading "-", so it can't become an ssh option.
const ADDRESS = /^[a-z_][a-z0-9._-]{0,31}@[a-z0-9][a-z0-9.:-]{0,252}$/i;
const UNSUPPORTED = /this installer (?:runs on a Linux server|needs Ubuntu or Debian|needs systemd)/;

/** `user@address` as the person typed it, or null when it isn't one. */
export function sshAddress(input) {
  const address = String(input ?? "").trim();
  return ADDRESS.test(address) ? address : null;
}

/** Why ssh itself (exit 255) didn't get to run the installer. */
export function sshFailure(stderr) {
  if (/Permission denied|Too many authentication failures/i.test(stderr)) return "ssh-key";
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) return "ssh-host-key";
  return "ssh-unreachable";
}

/**
 * Runs the installer (`script`, its text) on `address` and returns the pairing link it printed. Installer steps go to
 * `onProgress` as `{ step: "installing", detail }`.
 */
export function setupOverSsh({ address, script, onProgress = () => {}, spawn = spawnProcess, timeoutMs = INSTALL_TIMEOUT_MS }) {
  const target = sshAddress(address);
  if (!target) return Promise.resolve({ ok: false, error: { code: "ssh-address" } });
  onProgress({ step: "installing" });
  return new Promise((resolve) => {
    const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", target, "bash -s --"];
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const readSteps = createStepReader((detail) => onProgress({ step: "installing", detail }));
    let log = "", errors = "", settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: { code: "timeout" } });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { readSteps(chunk); log = appendOutput(log, chunk); });
    child.stderr.on("data", (chunk) => { errors = appendOutput(errors, chunk); log = appendOutput(log, chunk); });
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish({ ok: false, error: { code: error?.code === "ENOENT" ? "ssh-missing" : "ssh-unreachable" } }));
    child.on("close", (code) => {
      const link = code === 0 ? pairingLinkIn(log) : null;
      if (link) return finish({ ok: true, link });
      if (code === SSH_FAILED) return finish({ ok: false, error: { code: sshFailure(errors) } });
      if (UNSUPPORTED.test(errors)) return finish({ ok: false, error: { code: "unsupported" } });
      finish({ ok: false, error: { code: "install-failed", output: lastLines(log) } });
    });
    child.stdin.end(script);
  });
}
