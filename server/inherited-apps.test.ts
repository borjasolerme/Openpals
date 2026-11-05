import { describe, expect, it } from "vitest";

import { appsFromCreator, type AppGrants } from "./inherited-apps.ts";

const ADA = "ada@acme.test";
const OFF = { composio: false, connectorTools: {}, mcpServers: [] };
const chief = {
  visibility: { people: [ADA] },
  composio: true, connectorTools: { gmail: { tools: ["GMAIL_FETCH_EMAILS"] } }, connectorScopes: { apps: { gmail: "read" as const } }, mcpServers: ["notes"],
};
const grants = ({ composio, connectorTools, connectorScopes, mcpServers }: AppGrants) => ({ composio, connectorTools, connectorScopes, mcpServers });

describe("the connected apps a bot a Chief creates starts with", () => {
  it("are the Chief's own, level for level", () => {
    expect(appsFromCreator(chief, { visibility: { people: [ADA] } })).toEqual(grants(chief));
    expect(appsFromCreator({ connectorScopes: { apps: { slack: "read" } } }, {})).toEqual({ connectorScopes: { apps: { slack: "read" } } });
    expect(appsFromCreator({}, {}), "a Chief on every app makes a bot on every app").toEqual({});
  });

  it("go only to a bot exactly the Chief's people see", () => {
    expect(appsFromCreator(chief, {}), "everyone").toEqual(OFF);
    expect(appsFromCreator(chief, { visibility: "admins" })).toEqual(OFF);
    expect(appsFromCreator(chief, { visibility: { people: [ADA, "cleo@acme.test"] } })).toEqual(OFF);
    expect(appsFromCreator({ ...chief, visibility: "everyone" }, {})).toEqual(grants(chief));
  });
});
