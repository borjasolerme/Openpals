import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "sk-ant-api03-ZZtestSECRET0123456789";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, refs: [] as Array<{ current: unknown }>, refIndex: 0,
  api: vi.fn(), dispatch: vi.fn(), config: {} as Record<string, unknown>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
  useId: () => "row",
  useRef: (current: unknown) => {
    const index = fixture.refIndex++;
    fixture.refs[index] ??= { current };
    return fixture.refs[index];
  },
}));
vi.mock("@/state/store", async (original) => {
  const store = await original<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: { ...store.initialState, config: fixture.config, instances: [] }, dispatch: fixture.dispatch }) };
});
const { ApiError } = await import("@/state/store");
const { KeyRow } = await import("./KeyRow");

type Props = { children?: ReactNode; type?: string; onChange?: (event: { target: { value: string } }) => void; onKeyDown?: (event: { key: string; preventDefault: () => void }) => void; onClick?: () => void; "data-key-remove"?: boolean };
function nodes(tree: ReactNode): Array<ReactElement<Props>> {
  return Children.toArray(tree).flatMap((child) => isValidElement<Props>(child) ? [child, ...nodes(child.props.children)] : []);
}
function render(props: Parameters<typeof KeyRow>[0]) {
  fixture.index = 0;
  fixture.refIndex = 0;
  return nodes(KeyRow(props));
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const input = (tree: Array<ReactElement<Props>>) => tree.find((node) => node.type === "input")!;

async function enterKey(props: Parameters<typeof KeyRow>[0]) {
  input(render(props)).props.onChange!({ target: { value: KEY } });
  input(render(props)).props.onKeyDown!({ key: "Enter", preventDefault: () => {} });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.values = [];
  fixture.refs = [];
  fixture.config = { anthropic: { configured: false }, box: { configured: false } };
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("a key saved in Settings → API keys", () => {
  it("tests a key once it is saved", async () => {
    fixture.api.mockResolvedValueOnce({ ...fixture.config, anthropic: { configured: true, last4: KEY.slice(-4) } }).mockResolvedValueOnce({ ok: true, check: "authentication" });
    await enterKey({ id: "anthropic" });
    expect(fixture.api.mock.calls.map(([path]) => path)).toEqual(["/api/config", "/api/keys/test"]);
  });

  it("does not test again a Boat key the server checked on save", async () => {
    fixture.api.mockResolvedValueOnce({ box: { configured: true } });
    await enterKey({ id: "box" });
    expect(fixture.api).toHaveBeenCalledOnce();
  });

  it("saves an xAI key through the desktop's encrypted store, so Remove clears the stored copy too", async () => {
    const setCredential = vi.fn().mockResolvedValue({ xai: { configured: true } });
    vi.stubGlobal("window", { ogb: { setCredential } });
    fixture.api.mockResolvedValue({ ok: true });
    await enterKey({ id: "xai" });
    expect(setCredential).toHaveBeenCalledWith("xaiApiKey", KEY);
    expect(fixture.api.mock.calls.map(([path]) => path)).toEqual(["/api/keys/test"]);
  });

  it("removes a key once at a time, and tries again after a failed remove", async () => {
    fixture.config = { anthropic: { configured: true, last4: "6789" } };
    fixture.api.mockRejectedValueOnce(new ApiError("busy", 409, { error: "busy" })).mockResolvedValueOnce({ anthropic: { configured: false } });
    const remove = () => render({ id: "anthropic" }).find((node) => node.type === "button" && node.props["data-key-remove"])!;
    remove().props.onClick!();
    await flush();
    remove().props.onClick!();
    remove().props.onClick!();
    await flush();
    expect(fixture.api).toHaveBeenCalledTimes(2);
  });
});
