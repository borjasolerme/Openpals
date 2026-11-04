import assert from "node:assert/strict";
import test from "node:test";

import { BOT_PARTS, differenceSignature, itemKey, parseSendSummary, pendingRows, planSend } from "./cloud-send-parts.mjs";
import { botPatch, CloudSendError, parseSendState, sendNotice, unanswered } from "./cloud-send.mjs";

const CLOUD = "https://omb-u-1.fly.dev";
const summary = (items) => ({ v: 1, appVersion: "0.1.117", items });
const bot = (id, parts, extra = {}) => ({ key: itemKey.bot(id), kind: "bot", label: id, id, parts, ...extra });

test("a part goes when it changed here and not there; the server's own change is kept; what was removed there stays removed", () => {
  const here = summary([
    bot("ember", { soul: "s2", title: "t2", name: "n1" }),
    bot("juno", { soul: "j1" }),
    { key: itemKey.login("example.test", "alice"), kind: "login", label: "example.test", id: "l1", parts: { saved: "a1" } },
    { key: itemKey.setting("profile"), kind: "setting", label: "profile", parts: { name: "amit", about: "-" } },
  ]);
  const there = summary([
    bot("ember", { soul: "s1", title: "t9", name: "n1" }),
    { key: itemKey.setting("profile"), kind: "setting", label: "profile", parts: { name: "-", about: "-" } },
    bot("miso", { soul: "m1" }),
  ]);
  const sent = { [itemKey.bot("ember")]: { soul: ["s1", "s1"], title: ["t1", "t1"] }, [itemKey.login("example.test", "alice")]: { saved: ["a1", "c1"] } };
  const plan = planSend({ local: here, cloud: there, sent });
  const by = Object.fromEntries(plan.rows.map((row) => [row.key, row]));
  assert.deepEqual([by["bot:ember"].state, by["bot:ember"].parts, by["bot:ember"].differs], ["to-update", ["soul"], ["title"]]);
  assert.equal(by["bot:juno"].state, "only-here");
  assert.equal(by[itemKey.login("example.test", "alice")].state, "removed");
  assert.deepEqual(plan.removed, [itemKey.login("example.test", "alice")]);
  // the server has no value: this computer's fills it; an equal part is remembered as in step.
  assert.deepEqual(by["setting:profile"].parts, ["name"]);
  assert.deepEqual(plan.baseline["bot:ember"], { name: ["n1", "n1"] });
  assert.deepEqual(plan.cloudOnly.map((row) => row.key), ["bot:miso"]);
  // The person chooses this computer's: the differing part goes too.
  assert.deepEqual(planSend({ local: here, cloud: there, sent, force: ["bot:ember"] }).rows.find((row) => row.key === "bot:ember").parts, ["soul", "title"]);
  // A login both sides have, never sent from here: in step from now on (its secret can't be compared).
  const logins = planSend({ local: summary([{ key: "login:a.test|amit", kind: "login", label: "a.test", parts: { saved: "1" } }]),
    cloud: summary([{ key: "login:a.test|amit", kind: "login", label: "a.test", parts: { saved: "9" } }]) });
  assert.deepEqual([logins.rows[0].state, logins.baseline["login:a.test|amit"]], ["on-both", { saved: ["1", "9"] }]);
  // Unchanged here, changed there: nothing goes.
  const quiet = planSend({ local: summary([bot("ember", { soul: "s1" })]), cloud: summary([bot("ember", { soul: "s5" })]), sent: { "bot:ember": { soul: ["s1", "s1"] } } });
  assert.equal(quiet.rows[0].state, "on-both");
});

test("a bot's skills go with the bot, follow its switch, and a removed bot's skills read as removed", () => {
  const skill = { key: itemKey.skill("ember", "notes"), kind: "skill", label: "notes", id: "notes", bot: "ember", parts: { text: "x", on: "on" } };
  const here = summary([bot("ember", { soul: "s" }), skill]);
  const plan = planSend({ local: here, cloud: summary([]) });
  assert.deepEqual(plan.rows.map((row) => row.state), ["only-here", "only-here"]);
  assert.deepEqual(pendingRows(plan).map((row) => row.key), ["bot:ember"]);
  assert.deepEqual(planSend({ local: here, cloud: summary([]), off: { "bot:ember": "you" } }).rows.map((row) => row.state), ["off", "off"]);
  assert.deepEqual(planSend({ local: here, cloud: summary([]), off: { "bot:ember": "removed" } }).rows.map((row) => row.state), ["removed", "removed"]);
  assert.equal(differenceSignature(plan), "bot:ember#only-here#");
});

test("a server's answer is kept only in the shape main relies on", () => {
  const parsed = parseSendSummary({ v: 1, appVersion: "0.1.117", items: [
    { key: "bot:ember", kind: "bot", label: "Ember", id: "ember", parts: { soul: "abc", "../x": "y", look: 5 } },
    { key: "evil", kind: "bot", parts: {} },
    { key: "bot:x", kind: "spaceship", parts: {} },
  ] });
  assert.deepEqual(parsed.items, [{ key: "bot:ember", kind: "bot", label: "Ember", id: "ember", parts: { soul: "abc" } }]);
  assert.equal(parseSendSummary({ v: 2, items: [] }), null);
  assert.equal(parseSendSummary(null), null);
});

test("a bot's fields reach the server without Custom approval and without naming bots the server lacks", () => {
  const ember = { id: "ember", soul: "Be brief.", approvalMode: "custom", alwaysAllow: ["Bash(ls)"], peers: ["juno", "kit"], modelSelection: { instanceId: "claude", model: "m", extra: 1 }, cwd: "/Users/amit/work" };
  const body = botPatch(ember, ["soul", "access", "team", "model"], new Set(["juno"]));
  assert.deepEqual(body, { soul: "Be brief.", alwaysAllow: ["Bash(ls)"], peers: ["juno"], modelSelection: { instanceId: "claude", model: "m" }, requireAvailableModel: true });
  assert.ok(!Object.values(BOT_PARTS).flat().includes("cwd"), "a working folder is this computer's");
  assert.deepEqual(parseSendState({ auto: false, clouds: { "javascript:alert(1)": {}, [CLOUD]: { off: { a: "you", b: "nonsense" }, created: { "bot:x": true, "login:y": true }, creating: { "bot:z": true, "skill:q": true }, release: [{ id: "mcp:a", digest: "d" }, { id: 3 }] } } }),
    { v: 1, clouds: { [CLOUD]: { sent: {}, off: { a: "you" }, dismissed: "", last: null, whole: null, arrived: { bots: 0, updatedBots: 0, skills: 0, logins: 0, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } },
      chats: {}, created: { "bot:x": true }, creating: { "bot:z": true }, release: [{ id: "mcp:a", digest: "d" }], files: {}, on: {} } } }, "nothing is kept of the switch that once sent by itself");
});

test("1Password refusing the token on the server is final: the server's page is told not to offer Try again; any other failure keeps it", () => {
  const outcome = (failed, error) => ({ cloud: "ready", rows: [], last: { at: 1, reason: "auto", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [], failed }, ...(error ? { error } : {}) } });
  const refused = { key: "1password", kind: "1password", label: "1Password", error: "refused", final: true };
  const other = { key: "login:a", kind: "login", label: "a.example", error: "did not answer" };
  assert.equal(sendNotice(outcome([refused])).last.final, true);
  assert.equal(sendNotice(outcome([refused, other])).last.final, false);
  assert.equal(sendNotice(outcome([])).last.final, false);
  assert.equal(sendNotice(outcome([refused], "stopped")).last.final, false, "a send that stopped as a whole can be tried again");
});



test("nothing answering on the way to the server is told from a refusal", () => {
  assert.equal(unanswered(new TypeError("fetch failed")), true);
  assert.equal(unanswered(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), true);
  assert.equal(unanswered(Object.assign(new Error("Cloud request failed."), { status: 502 })), true);
  assert.equal(unanswered(new CloudSendError("session", "Cloud request failed.", { cause: new Error("x", { cause: Object.assign(new Error("y"), { status: 503 }) }) })), true);
  assert.equal(unanswered(Object.assign(new Error("This app could not sign in to the server. Try again."), { status: 401 })), false);
  assert.equal(unanswered(Object.assign(new Error("Too many connection links."), { status: 429 })), false);
  assert.equal(unanswered(new TypeError("session.call is not a function")), false);
  assert.equal(unanswered(new Error("The server is not ready.")), false);
});

