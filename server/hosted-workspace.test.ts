import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hostedWorkspaceConfiguration, hostedWorkspaceConfigured } from "./hosted-workspace.ts";
import { SessionRegistry } from "./sessions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a hosted workspace", () => {
  it("is hosted only when opted in, and a partial configuration counts as hosted", () => {
    expect(hostedWorkspaceConfigured({})).toBe(false);
    expect(hostedWorkspaceConfigured({ OMB_PUBLIC_URL: "https://legacy.example.test" })).toBe(false);
    expect(hostedWorkspaceConfigured({ OMB_ADMIN_URL: "" })).toBe(true);
    expect(hostedWorkspaceConfigured({ OMB_ADMIN_WORKSPACE: "acme" })).toBe(true);
    expect(hostedWorkspaceConfigured({ OMB_ADMIN_MEMBERSHIP: "portal" })).toBe(true);
  });
  it("requires complete valid hosted configuration before opting into portal membership", () => {
    const env = { OMB_ADMIN_URL: "https://admin.example.test", OMB_ADMIN_WORKSPACE: "acme", OMB_PUBLIC_URL: "https://acme.example.test" };
    expect(hostedWorkspaceConfiguration(env)?.portalMembership).toBe(false);
    expect(hostedWorkspaceConfiguration({ ...env, OMB_ADMIN_MEMBERSHIP: "portal" })?.portalMembership).toBe(true);
    expect(hostedWorkspaceConfiguration({ ...env, OMB_ADMIN_MEMBERSHIP: "local" })?.portalMembership).toBe(false);
    for (const patch of [{ OMB_ADMIN_URL: "" }, { OMB_PUBLIC_URL: "http://acme.example.test" }, { OMB_ADMIN_WORKSPACE: "" }, { OMB_ADMIN_MEMBERSHIP: "PORTAL" }]) {
      expect(hostedWorkspaceConfiguration({ ...env, OMB_ADMIN_MEMBERSHIP: "portal", ...patch })).toBeNull();
    }
    const dir = mkdtempSync(join(tmpdir(), "omb-hosted-"));
    dirs.push(dir);
    const invalid = { OMB_ADMIN_MEMBERSHIP: "portal" };
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), portalMembership: hostedWorkspaceConfiguration(invalid)?.portalMembership === true });
    const issued = sessions.issuePortal({ email: "member@example.test", grant: "g".repeat(43), scopes: ["client"] });
    expect(sessions.authenticate(issued.token)).toBeNull();
  });
});
