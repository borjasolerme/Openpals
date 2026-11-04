import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMoveKinds, fileArrived, keptBoth, planFiles } from "./cloud-send-kinds.mjs";

const GB = 1024 ** 3;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const file = (path, text) => ({ path, size: Buffer.byteLength(text), sha256: sha(text) });

test("a file arriving beside the server's own different one keeps its name with this computer's after it", () => {
  assert.equal(keptBoth("workspaces/b1/notes.md", "Amit's MacBook Air"), "workspaces/b1/notes (Amit's MacBook Air).md");
  assert.equal(keptBoth("task-workspaces/b1/t1/Makefile", "Mac/../x"), "task-workspaces/b1/t1/Makefile (Mac .. x)");
  assert.equal(keptBoth("workspaces/b1/.env.local", ""), "workspaces/b1/.env (this computer).local");
});

test("a file has arrived when the server holds its bytes at its path, or beside a file of its own under its name", () => {
  const notes = file("workspaces/b1/notes.md", "mine");
  const there = (entries) => new Map(entries.map((entry) => [entry.path, entry]));
  assert.equal(fileArrived(notes, there([file("workspaces/b1/notes.md", "mine")])), true);
  assert.equal(fileArrived(notes, there([file("workspaces/b1/notes.md", "theirs"), file("workspaces/b1/notes (Mac).md", "mine")])), true);
  assert.equal(fileArrived(notes, there([file("workspaces/b1/notes.md", "theirs"), file("workspaces/b1/other (Mac).md", "mine")])), false);
  assert.equal(fileArrived(notes, there([file("workspaces/b1/notes (Mac).md", "theirs")])), false);
});

test("each file goes new, replaces the one the move put there and only it, or goes beside the server's own: never over it", () => {
  const here = [file("workspaces/b1/new.md", "n"), file("workspaces/b1/same.md", "s"), file("workspaces/b1/edited.md", "e2"), file("workspaces/b1/theirs.md", "mine")];
  const there = new Map([file("workspaces/b1/same.md", "s"), file("workspaces/b1/edited.md", "e1"), file("workspaces/b1/theirs.md", "their own")].map((entry) => [entry.path, entry]));
  const plan = planFiles(here, there, { "workspaces/b1/edited.md": sha("e1"), "workspaces/b1/theirs.md": sha("older") }, "Mac");
  assert.deepEqual(plan.map(({ path, to, mode, expect, kept }) => ({ path, to, mode, expect, kept })), [
    { path: "workspaces/b1/new.md", to: "workspaces/b1/new.md", mode: "new", expect: undefined, kept: undefined },
    { path: "workspaces/b1/edited.md", to: "workspaces/b1/edited.md", mode: "replace", expect: sha("e1"), kept: undefined },
    { path: "workspaces/b1/theirs.md", to: "workspaces/b1/theirs (Mac).md", mode: "new", expect: undefined, kept: true },
  ]);
});

/** This computer's files and the server, which keeps what it takes; `free`: its free bytes. */
function filesSides({ here, there = [], free = 1e12, volume = 1e12, conflictAt = [] }) {
  const stored = new Map(there.map((entry) => [entry.path, { ...entry }]));
  const uploads = [], failed = [];
  const parts = new Map();
  const session = {
    call: async (method, route, body) => {
      if (method === "GET" && route === "/api/cloud-send/files") return { ok: true, status: 200, body: { files: [...stored.values()], space: { freeBytes: typeof free === "function" ? free() : free, volumeBytes: volume } } };
      if (method === "POST" && route === "/api/cloud-send/chats/attachments") return { ok: true, status: 200, body: { missing: body.names } };
      throw new Error(`unexpected ${method} ${route}`);
    },
    upload: async (route, bytes) => {
      const query = new URL(`http://x${route}`).searchParams;
      const path = query.get("path"), offset = Number(query.get("offset")), size = Number(query.get("size"));
      uploads.push([path, offset, bytes.length]);
      const key = `${query.get("sha256")}`;
      const held = parts.get(key) ?? 0;
      if (offset !== held) return { ok: false, status: 409, body: { received: held } };
      parts.set(key, held + bytes.length);
      if (held + bytes.length < size) return { ok: true, status: 200, body: { received: held + bytes.length } };
      if (conflictAt.includes(path) || (stored.has(path) && query.get("mode") !== "replace")) return { ok: false, status: 409, body: { conflict: true } };
      stored.set(path, { path, size, sha256: query.get("sha256") });
      parts.delete(key);
      return { ok: true, status: 201, body: { stored: true } };
    },
  };
  const texts = new Map(here.map((entry) => [entry.path, entry.text]));
  const state = { files: {} };
  const kinds = createMoveKinds({
    localJson: async (route) => {
      if (route === "/api/cloud-send/files") return { files: here.map(({ text: _text, ...entry }) => entry) };
      if (route === "/api/cloud-send/chats?attachments=1") return { attachments: [{ name: "a.png", size: 1000 }] };
      throw new Error(`unexpected ${route}`);
    },
    localBytes: async (route) => {
      const query = new URL(`http://x${route}`).searchParams;
      return new Uint8Array(Buffer.from(texts.get(query.get("path"))).subarray(Number(query.get("offset")), Number(query.get("offset")) + Number(query.get("length"))));
    },
    localSend: async () => ({ ok: true, status: 200 }), entry: () => state, persist() {}, progress() {},
    refusal: (answer, fallback) => answer.body?.error ?? fallback,
  });
  const ctx = { origin: "https://garage.example.test", session, result: { failed } };
  return { kinds, ctx, stored, uploads, failed, state };
}

test("the bots' files go once the server has room for them and the attachments still to go; on a conflict, beside the server's own", async () => {
  const notes = { ...file("workspaces/b1/notes.md", "mine"), text: "mine" };
  const sides = filesSides({ here: [notes, { ...file("workspaces/other/x.md", "x"), text: "x" }], there: [file("workspaces/b1/notes.md", "their own")] });
  await sides.kinds.moveFiles(sides.ctx, [{ id: "b1", name: "Nova" }], "Mac");
  assert.deepEqual(sides.failed, []);
  assert.deepEqual([...sides.stored.keys()].sort(), ["workspaces/b1/notes (Mac).md", "workspaces/b1/notes.md"]);
  assert.equal(sides.stored.get("workspaces/b1/notes.md").sha256, sha("their own"), "the server's own file is never written over");
  assert.deepEqual(sides.ctx.result.files, { sent: 1, kept: 1 });
  assert.deepEqual(sides.state.files, { "workspaces/b1/notes (Mac).md": sha("mine") });
});

test("a file the move put there that conflicts only when it lands goes beside, and a part the server holds already is not sent again", async () => {
  const report = { ...file("workspaces/b1/report.md", "x".repeat(10)), text: "x".repeat(10) };
  const sides = filesSides({ here: [report], conflictAt: ["workspaces/b1/report.md"] });
  await sides.kinds.moveFiles(sides.ctx, [{ id: "b1", name: "Nova" }], "Mac");
  assert.deepEqual(sides.uploads, [["workspaces/b1/report.md", 0, 10], ["workspaces/b1/report (Mac).md", 0, 10], ["workspaces/b1/report (Mac).md", 10, 0]]);
  assert.ok(sides.stored.has("workspaces/b1/report (Mac).md"));
});

test("files the server has no room for are said plainly and none of them goes", async () => {
  const big = { ...file("workspaces/b1/big.bin", "b"), size: 40 * GB, text: "b" };
  const full = filesSides({ here: [big], free: GB, volume: 10 * GB });
  await full.kinds.moveFiles(full.ctx, [{ id: "b1", name: "Nova" }], "Mac");
  assert.deepEqual(full.failed.map((entry) => [entry.key, entry.error]), [["files", "The server does not have enough space for this computer's files. Free some there, then try again."]]);
  assert.deepEqual(full.uploads, []);
});
