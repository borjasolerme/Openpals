import assert from "node:assert/strict";
import { test } from "node:test";
import { offerMoveToApplications } from "./move-to-applications.mjs";

const fakeApp = (inApplications, moved = true) => ({ isPackaged: true, isInApplicationsFolder: () => inApplications, moveToApplicationsFolder: () => moved, moves: 0 });
const answering = (response) => { const asked = []; return { asked, showMessageBox: async (options) => { asked.push(options); return { response }; } }; };

test("a Mac copy outside Applications asks once and moves itself on yes", async () => {
  const dialog = answering(0);
  assert.equal(await offerMoveToApplications({ app: fakeApp(false), dialog, platform: "darwin" }), true);
  assert.equal(dialog.asked.length, 1);
  assert.match(dialog.asked[0].message, /Move Openpals to Applications/);
});

test("Not now leaves it where it is", async () => {
  assert.equal(await offerMoveToApplications({ app: fakeApp(false), dialog: answering(1), platform: "darwin" }), false);
});

test("nothing is asked in Applications, in a development run or off macOS", async () => {
  for (const [app, platform] of [[fakeApp(true), "darwin"], [{ ...fakeApp(false), isPackaged: false }, "darwin"], [fakeApp(false), "win32"]]) {
    const dialog = answering(0);
    assert.equal(await offerMoveToApplications({ app, dialog, platform }), false);
    assert.equal(dialog.asked.length, 0);
  }
});

test("a move that fails says to drag it into Applications", async () => {
  const dialog = answering(0);
  const app = { ...fakeApp(false), moveToApplicationsFolder: () => { throw new Error("denied"); } };
  assert.equal(await offerMoveToApplications({ app, dialog, platform: "darwin" }), false);
  assert.match(dialog.asked[1].detail, /Drag Openpals into Applications/);
});
