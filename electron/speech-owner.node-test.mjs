import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { closeSync, constants, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ownerSource = `
  import { registerHooks } from 'node:module';
  const moduleURL = source => 'data:text/javascript,' + encodeURIComponent(source);
  registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/speech.mjs')) {
      if (specifier === 'electron') return { shortCircuit: true, url: moduleURL(
        'export const app = { isPackaged: true, getPath: () => process.argv[1] };') };
      if (specifier === 'node:child_process') return { shortCircuit: true, url: moduleURL(\`
        export { execFileSync } from 'node:child_process';
        import { EventEmitter } from 'node:events';
        export function spawn(file, args, options) {
          if (process.argv[2] === 'throw') throw new Error('launch failed');
          globalThis.speechProc = new EventEmitter();
          process.send({ type: 'launch', file, args, options });
          return globalThis.speechProc;
        }
      \`) };
    }
    return next(specifier, context);
  } });
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  process.resourcesPath = '/synthetic-speech-resources';
  const speech = await import(${JSON.stringify(new URL('./speech.mjs', import.meta.url).href)});
  const sink = { transcript() {}, end(info) { process.send({ type: 'end', info }); }, replaced() {} };
  process.on('message', command => {
    if (command === 'close') globalThis.speechProc.emit('close', 0);
    if (command === 'error') globalThis.speechProc.emit('error', new Error('launch failed'));
    if (command === 'stop') speech.stopSpeech();
    if (command === 'finish') speech.finishSpeech();
    process.send({ type: 'done', command });
  });
  speech.startSpeech(sink);
`;

async function owner(t, mode = "ok") {
  const dir = mkdtempSync(path.join(tmpdir(), "speech-owner-"));
  const proc = fork("--eval", [ownerSource, dir, mode], {
    execArgv: ["--input-type=module"], silent: true,
  });
  const exit = once(proc, "exit");
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exit;
    rmSync(dir, { recursive: true, force: true });
  });
  const [message] = await once(proc, "message");
  return { proc, dir, message, exit };
}

function readLifeline(t, message) {
  assert.equal(message.type, "launch");
  const index = message.args.indexOf("--lifeline-file");
  assert.ok(index >= 0, "the helper must receive an owner lifeline");
  const file = message.args[index + 1];
  assert.equal(statSync(file).isFIFO(), true);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  t.after(() => closeSync(fd));
  return () => readSync(fd, Buffer.alloc(1), 0, 1, null);
}

const options = { skip: process.platform === "win32" && "needs POSIX FIFO", timeout: 10_000 };

test("a speech helper's lifeline reaches EOF when its Electron owner is SIGKILLed", options, async t => {
  const { proc, message, exit } = await owner(t);
  const read = readLifeline(t, message);
  assert.throws(read, { code: "EAGAIN" }, "an active owner keeps the pipe open without sending data");
  proc.kill("SIGKILL");
  await exit;
  assert.equal(read(), 0, "owner death must close the only writer");
});

for (const command of ["close", "error"]) {
  test(`speech ${command} closes the lifeline and removes the session`, options, async t => {
    const { proc, dir, message } = await owner(t);
    const read = readLifeline(t, message);
    proc.send(command);
    await once(proc, "message");
    assert.equal(read(), 0);
    assert.deepEqual(readdirSync(dir), []);
  });
}

test("stop and finish retain their markers while the owner lifeline stays open", options, async t => {
  const { proc, message } = await owner(t);
  const read = readLifeline(t, message);
  const flag = name => message.args[message.args.indexOf(name) + 1];
  proc.send("finish");
  await once(proc, "message");
  assert.equal(readFileSync(flag("--finish-file"), "utf8"), "finish");
  assert.equal(existsSync(flag("--stop-file")), false);
  assert.throws(read, { code: "EAGAIN" });
  proc.send("stop");
  await once(proc, "message");
  assert.equal(readFileSync(flag("--stop-file"), "utf8"), "stop");
  assert.throws(read, { code: "EAGAIN" });
});

test("a synchronous launch failure removes the session and its lifeline", options, async t => {
  const { dir, message } = await owner(t, "throw");
  assert.deepEqual(message, { type: "end", info: { code: 1, reason: "helper-start-failed" } });
  assert.deepEqual(readdirSync(dir), []);
});
