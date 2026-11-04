import assert from "node:assert/strict";
import test from "node:test";

import { createLendingTarget } from "./lending-target.mjs";

test("a server of the person's own is lent only while it is their bots' home, bound to that server's identity", () => {
  const garage = { id: "g", kind: "remote", name: "Garage server", origin: "https://garage.example.test" };
  const family = { id: "f", kind: "remote", name: "Family server", origin: "https://family.example.test" };
  let own = null;
  const target = createLendingTarget({ environments: () => [garage, family], ownHome: () => own });
  assert.deepEqual(target.places(), [], "connected by hand, never lent by itself");
  assert.equal(target.environment(), null);
  assert.equal(target.cloud(garage).status, "signed-out", "no lending of its own ever passes");
  own = { origin: garage.origin, environmentId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f" };
  assert.deepEqual(target.places().map((place) => place.name), ["Garage server"]);
  assert.equal(target.environment(), garage);
  assert.deepEqual(target.cloud(garage), { status: "connected", accountId: "own:7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", origin: garage.origin });
  assert.deepEqual(target.cloud(), target.cloud(garage), "the summary asks without a place");
  assert.equal(target.cloud(family).status, "signed-out", "any other place's lending ends");
  own = null;
  assert.deepEqual(target.places(), []);
  assert.equal(target.cloud(garage).status, "signed-out", "once it isn't home, the lending bound to it ends");
});
