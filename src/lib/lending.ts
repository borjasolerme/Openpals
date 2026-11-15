// The desktop's "Let my bots use this computer" bridge (window.ogb.lending), as the Settings card reads it.
import type { LendingView, ScreenStatus } from "../../electron/computer-sharing.mjs";

export interface LendingState extends LendingView {
  /** This app is paired with a server, so this computer can be lent to it. */
  available: boolean;
  serverName: string | null;
  device: "Mac" | "PC" | "computer";
  platform: string;
  screen: ScreenStatus | null;
  /** Openpals opens at login here; null where this build can't set it. */
  openAtLogin: boolean | null;
}

export interface LendingBridge {
  state(): Promise<LendingState>;
  turnOn(name?: string): Promise<LendingState>;
  turnOff(): Promise<LendingState>;
  pause(): Promise<LendingState>;
  resume(): Promise<LendingState>;
  rename(name: string): Promise<LendingState>;
  setTerminal(on: boolean): Promise<LendingState>;
  setScreen(on: boolean): Promise<LendingState>;
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

/** One word for where lending stands, for the card's badge. */
export type LendingPhase = "off" | "paused" | "online" | "connecting" | "problem";

export function lendingPhase(state: Pick<LendingState, "on" | "paused" | "state">): LendingPhase {
  if (!state.on) return "off";
  if (state.paused) return "paused";
  if (state.state === "online") return "online";
  if (state.state === "connecting") return "connecting";
  return "problem";
}

/** macOS hasn't allowed screen control yet: the card shows how to allow it. */
export function needsMacPermissions(state: Pick<LendingState, "platform" | "screen" | "lendsScreen">): boolean {
  return state.platform === "darwin" && state.lendsScreen && state.screen?.reason === "permissions";
}
