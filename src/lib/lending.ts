// The desktop's "Let bots use this computer" bridge (window.ogb.lending), as the Settings card reads it.
import type { LendingTarget, LendingView, ScreenStatus } from "../../electron/computer-sharing.mjs";

export type { LendingTarget };

export interface LendingState extends LendingView {
  device: "Mac" | "PC" | "computer";
  platform: string;
  screen: ScreenStatus | null;
  /** Openpals opens at login here; null where this build can't set it. */
  openAtLogin: boolean | null;
  /** The last try of "Use my Chrome without the mouse": null until tried. */
  chromeCheck: { ok: true } | { ok: false; error: string } | null;
}

export interface LendingBridge {
  state(): Promise<LendingState>;
  /** A link from a server's "Add a computer": main asks the person, then lends this computer to that server. */
  addLink(link: string): Promise<LendingState>;
  pauseTarget(id: string): Promise<LendingState>;
  resumeTarget(id: string): Promise<LendingState>;
  removeTarget(id: string): Promise<LendingState>;
  turnOn(): Promise<LendingState>;
  turnOff(): Promise<LendingState>;
  pause(): Promise<LendingState>;
  resume(): Promise<LendingState>;
  rename(name: string): Promise<LendingState>;
  setTerminal(on: boolean): Promise<LendingState>;
  setScreen(on: boolean): Promise<LendingState>;
  setChrome(on: boolean): Promise<LendingState>;
  openChromeSetup(): Promise<LendingState>;
  addFolder(): Promise<LendingState>;
  removeFolder(id: string): Promise<LendingState>;
  allowScreen(): Promise<LendingState>;
  openPrivacy(pane: "accessibility" | "screen"): Promise<LendingState>;
  setOpenAtLogin(on: boolean): Promise<LendingState>;
  showActivity(): Promise<void>;
  onChanged(callback: (summary: Partial<LendingState>) => void): () => void;
}

export function lendingBridge(): LendingBridge | null {
  return typeof window === "undefined" ? null : window.ogb?.lending ?? null;
}

/** One word for where lending to a server stands, for its badge. */
export type LendingPhase = "off" | "paused" | "online" | "connecting" | "problem";

export function lendingPhase(state: Pick<LendingTarget, "paused" | "state">): LendingPhase {
  if (state.state === "off") return "off";
  if (state.paused || state.state === "paused") return "paused";
  if (state.state === "online") return "online";
  if (state.state === "connecting") return "connecting";
  return "problem";
}

/** macOS hasn't allowed screen control yet: the card shows how to allow it. */
export function needsMacPermissions(state: Pick<LendingState, "platform" | "screen" | "lendsScreen">): boolean {
  return state.platform === "darwin" && state.lendsScreen && state.screen?.reason === "permissions";
}

/** A link from "Add a computer": a pairing link that lends (https://host/pair#code=…&lend=1). */
export function isLendLink(input: string): boolean {
  const link = input.trim();
  if (/[\s\\]/.test(link)) return false;
  try {
    const url = new URL(link);
    const hash = new URLSearchParams(url.hash.slice(1));
    return (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.pathname === "/pair" || url.pathname === "/pair/") && !url.search && hash.get("lend") === "1" && Boolean(hash.get("code"));
  } catch {
    return false;
  }
}
