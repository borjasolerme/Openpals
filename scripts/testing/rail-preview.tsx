import { createRoot } from "react-dom/client";
import type { RailPlace, RailState } from "../../electron/cloud-rail.mjs";
import type { PlaceLook, PlaceSwatch } from "../../electron/place-look.mjs";
import App from "../../src/App";
import { ChromeRail } from "../../src/components/ChromeRail";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { NOTICES } from "../../src/lib/notices";
import { setSidebarDensity, SIDEBAR_WIDTH_KEY, SIMPLE_SIDEBAR_WIDTH_KEY } from "../../src/lib/sidebar-preferences";
import { markSimpleModePromptSeen } from "../../src/lib/simple-mode-prompt";
import { applySkin, type SkinId } from "../../src/lib/skins";
import "../../src/styles.css";

// Served only by scripts/verify-window-frame.ts: the real app, as a server's page in the desktop window sees it, with the
// desktop bridge that page gets (its rail answered here). ?skin= picks the skin, ?mode=simple Simple mode, ?sheet=add
// opens ＋'s sheet, ?places=many the list past eight (?more opens it). ?look=<colour>|none is the place's colour (its
// tint), ?name= the server's name, ?settings=look Settings → Appearance at the place's colour, ?menu=<id> that circle's
// own menu (a right-click: its colour). ?place=computer is this computer's own page instead: no rail, or with ?rail one
// beside it. ?density=icons collapses the sidebar to avatars; ?settings=general opens Settings at its first page,
// ?settings=strip at the switch for the window's rail. ?hidden starts with the rail hidden (the sidebar's button shows it
// again). The rail is drawn on the page itself; ?chrome draws the window's own rail instead, as the desktop window does:
// this page again in a frame of the rail's width at the left (?railpage, the rail's own page with the list main gives it
// alone), and the room the app's preload leaves for it. ?platform=win32 is a Windows window, its caption buttons drawn
// by the app. ?framecolor=today|app paints the frame in another colour to compare: the grey it had, or the app's own.
// ?frame=off is the window with its frame turned off (macOS's traffic lights back in the sidebar's corner; Windows' own
// title bar, as after the app started again), and ?framepending a Windows window whose frame was just turned off, until
// the app starts again. ?settings=frame opens Settings at the window frame's switch. Each page starts with the sidebar at
// its own width.
const params = new URLSearchParams(location.search);
markSimpleModePromptSeen();
try {
  for (const notice of NOTICES) localStorage.setItem(notice, "1");
  for (const width of [SIDEBAR_WIDTH_KEY, SIMPLE_SIDEBAR_WIDTH_KEY]) localStorage.removeItem(width);
} catch {}
setAdvancedMode(params.get("mode") !== "simple");
setSidebarDensity(params.get("density") === "icons" ? "icons" : "comfortable");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const FRAME_COLOURS: Record<string, string> = { today: "color-mix(in oklab, var(--color-panel) 93%, var(--color-ink))", app: "var(--color-app)" };
const frameColour = FRAME_COLOURS[params.get("framecolor") ?? ""];
if (frameColour) {
  const paint = document.createElement("style");
  paint.textContent = `html[data-skin], html { --color-frame: ${frameColour} !important; }`;
  document.head.append(paint);
}

const frameOff = params.get("frame") === "off", framePending = params.has("framepending");

const serverName = params.get("name") ?? "Office";
const place = (id: string, name: string, extra: Partial<RailPlace> = {}): RailPlace => ({ id, name, color: null, kind: "server", opens: true, ...extra });
const FEW: RailPlace[] = [
  place("local", "This computer", { kind: "computer" }),
  place("office", serverName, { color: "blue" }),
  place("mini", "Mac mini", { color: "teal", makeHome: true }),
  place("garage", "Garage server", { color: "orange" }),
];
const MANY = [...FEW, ...["Delta", "Echo Studio", "Fable", "Gamma Ltd", "Harbor"].map((name, n) => place(`x${n}`, name, { color: (["teal", "yellow", "red", "purple", "blue"] as const)[n] }))];
const computer = params.get("place") === "computer";
const COMPUTER: RailPlace[] = [place("local", "This computer", { kind: "computer" }), place("office", serverName)];
const SWATCH: Record<string, PlaceSwatch> = { blue: "blue", teal: "green", yellow: "amber", red: "rose", purple: "violet" };
const COLOR: Record<PlaceSwatch, PlaceLook["color"]> = { blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null };
const tint = params.get("look") ?? (computer ? "none" : "blue");
const color = tint === "none" ? null : (tint as PlaceLook["color"]);
const listed = computer ? (params.has("rail") ? COMPUTER : []) : params.get("places") === "many" ? MANY : FEW;
const onScreen = computer ? "local" : "office";
// The place on screen wears the colour its tint is drawn in; every place has its colour changed from its circle.
const painted = (entry: RailPlace): RailPlace => ({ ...entry, paint: { swatch: entry.color ? SWATCH[entry.color] ?? null : null },
  ...(entry.kind === "server" ? { removable: true as const, forget: true as const } : {}) });
const rail: RailState = { places: listed.map(({ active: _active, ...entry }) => painted(entry.id === onScreen ? { ...entry, color, active: true as const } : entry)),
  add: { link: true, address: computer } };
let look: PlaceLook = { name: computer ? "This computer" : serverName, color, swatch: color ? SWATCH[color] ?? null : null };
let openSettings: ((section?: string) => void) | null = null;
const ok = async () => {};
const windows = params.get("platform") === "win32";
const chrome = params.has("chrome");
const RAIL_WIDTH = 36;
let hidden = params.has("hidden");
const placesHeard = new Set<() => void>(), stripHeard = new Set<(state: { available: boolean; hidden: boolean }) => void>();
const strip = () => ({ available: listed.length > 1, hidden });
let frameOn = !frameOff && !framePending;
const capabilitiesHeard = new Set<(next: object) => void>();
const capabilities = async () => ({
  host: windows ? { platform: "win32", label: "Windows", session: "unknown", packaged: true } : { platform: "darwin", label: "macOS", session: "unknown", packaged: true },
  windowChrome: windows ? (frameOff ? "native" : "win-caption") : "mac-inset",
  windowFrame: windows ? !frameOff : frameOn,
  screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false },
  localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
});
const recolor = async (id: string, swatch: PlaceSwatch) => {
  rail.places = rail.places.map((entry) => (entry.id === id ? { ...entry, color: COLOR[swatch], paint: { swatch: COLOR[swatch] ? swatch : null } } : entry));
  return { outcome: "saved", look: null };
};

if (params.has("railpage")) {
  // The window's own rail page: see-through but for the rail, as main.tsx draws it.
  document.documentElement.style.background = document.body.style.background = "transparent";
  Object.assign(window, { ogb: {
    platform: windows ? "win32" : "darwin", getCapabilities: capabilities, onCapabilitiesChanged: () => () => {}, applySkin: ok,
    workspaces: { places: async () => rail, open: ok, add: ok, recolor, onChanged: () => () => {} },
    rail: { expand: ok, onSkin: () => () => {} },
  } });
  createRoot(document.getElementById("root")!).render(<ChromeRail />);
} else {
  const room = document.createElement("style");
  room.textContent = `html { box-sizing: border-box !important; padding-left: ${RAIL_WIDTH}px !important; --rail-beside: ${RAIL_WIDTH}px; }`;
  const railPage = document.createElement("iframe");
  railPage.setAttribute("data-rail-page", "");
  railPage.title = "The window's rail";
  railPage.src = `${location.pathname}?${new URLSearchParams([...params, ["railpage", "1"]])}`;
  const titleBar = windows && frameOff ? 31 : 0;
  railPage.style.cssText = `position:fixed;left:0;top:${titleBar}px;width:${RAIL_WIDTH}px;height:calc(100vh - ${titleBar}px);border:0;z-index:90;background:transparent;color-scheme:normal`;
  const besidePage = () => {
    if (chrome && !hidden) { document.head.append(room); document.body.append(railPage); } else { room.remove(); railPage.remove(); }
  };
  besidePage();
  Object.assign(window, { ogb: {
    platform: windows ? "win32" : "darwin",
    app: { version: "0.1.130", ownPage: computer },
    getCapabilities: capabilities,
    onCapabilitiesChanged: (heard: (next: object) => void) => { capabilitiesHeard.add(heard); return () => { capabilitiesHeard.delete(heard); }; },
    onOpenAppSettings: (callback: (section?: string) => void) => { openSettings = callback; return () => {}; },
    applySkin: ok, setUnreadCount: () => {}, permStatus: async () => ({}),
    workspaces: {
      state: async () => (computer ? { local: true, name: "This computer" } : { local: false, name: serverName, origin: "https://office.example", color: "blue" }),
      menu: ok, open: ok, add: ok,
      places: async () => (hidden ? { ...rail, places: [] } : chrome ? { ...rail, places: [], beside: true as const } : rail),
      onChanged: (heard: () => void) => { placesHeard.add(heard); return () => { placesHeard.delete(heard); }; },
      look: async () => look,
      recolor,
      color: async (swatch: PlaceSwatch) => { look = { ...look, swatch: COLOR[swatch] ? swatch : null, color: COLOR[swatch] }; return { outcome: "saved", look }; },
    },
    windowFrame: {
      state: async () => ({ on: frameOn, restart: windows && framePending }),
      set: async (on: boolean) => { frameOn = on; for (const heard of capabilitiesHeard) heard(await capabilities()); return { on, restart: windows }; },
    },
    ...(framePending ? { relaunch: async () => true } : {}),
    rail: {
      state: async () => strip(),
      setHidden: async (next: boolean) => {
        hidden = next;
        besidePage();
        for (const heard of placesHeard) heard();
        for (const heard of stripHeard) heard(strip());
        return strip();
      },
      onState: (heard: (state: { available: boolean; hidden: boolean }) => void) => { stripHeard.add(heard); return () => { stripHeard.delete(heard); }; },
    },
    ...(windows && !frameOff ? { windowControls: { minimize: async () => true, toggleMaximize: async () => true, close: async () => true, state: async () => ({ maximized: false }), onMaximizedChanged: () => () => {} } } : {}),
  } });

  createRoot(document.getElementById("root")!).render(<App />);

  // The macOS window's traffic lights, drawn where the system draws them (electron/window-chrome.mjs), so the picture
  // shows what sits beside them.
  if (!windows) {
    const lights = document.createElement("div");
    lights.setAttribute("aria-hidden", "true");
    lights.style.cssText = `position:fixed;left:${frameOn ? 12 : 16}px;top:${frameOn ? 7 : 16}px;display:flex;gap:9px;z-index:100;pointer-events:none`;
    for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
      const dot = document.createElement("span");
      dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};display:block`;
      lights.append(dot);
    }
    document.body.append(lights);
  } else if (frameOff) {
    // Windows' own title bar is drawn outside the page; this stands in for it, above the page.
    const bar = document.createElement("div");
    bar.setAttribute("aria-hidden", "true");
    const dark = ["midnight", "foundry", "graphite", "dusk", "halloween"].includes(params.get("skin") ?? "midnight");
    bar.style.cssText = `position:fixed;inset:0 0 auto 0;height:31px;display:flex;align-items:center;z-index:100;font:12px "Segoe UI",sans-serif;padding-left:12px;${dark ? "background:#202020;color:#fff" : "background:#f3f3f3;color:#000"}`;
    bar.innerHTML = `<span style="flex:1">Openpals</span>${["\u2013", "\u2610", "\u2715"].map((glyph) => `<span style="width:46px;text-align:center">${glyph}</span>`).join("")}`;
    document.body.append(bar);
    const below = document.createElement("style");
    below.textContent = "html { padding-top: 31px !important; box-sizing: border-box !important; } #root { height: calc(100vh - 31px) !important; }";
    document.head.append(below);
  }

  const click = (selector: string) => new Promise<void>((resolve) => {
    const tick = () => { const target = document.querySelector<HTMLElement>(selector); if (target) { target.click(); resolve(); } else setTimeout(tick, 100); };
    tick();
  });
  if (params.get("sheet") === "add") void click("[data-rail-add]");
  const openedSettings = () => new Promise<void>((resolve) => { const tick = () => { if (openSettings) { openSettings(); resolve(); } else setTimeout(tick, 100); }; tick(); });
  const settings = params.get("settings");
  if (settings) {
    // Simple mode's General page has the sidebar's rows and the rail's switch; Advanced keeps them in Appearance.
    void openedSettings().then(() => (params.get("mode") === "simple" || settings === "general" ? undefined : click('[data-settings-section="appearance"]')))
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 300)))
      .then(() => {
        if (settings === "general") return document.querySelector("[data-settings-block='appearance']")?.scrollIntoView({ block: "start" });
        if (settings === "frame") return document.querySelector("[data-window-frame-switch]")?.scrollIntoView({ block: "center" });
        // The rail's switch closes the picture, with the sidebar's own rows above it.
        if (settings === "strip") return document.querySelector("[data-rail-switch]")?.scrollIntoView({ block: "end" });
        const shown = document.querySelector("[data-place-look], [data-place-picture]");
        (shown?.closest("[data-sidebar-look]") ?? shown)?.scrollIntoView({ block: "center" });
      });
  }
  if (params.has("more")) void click("[data-rail-more-button]");
  const menu = params.get("menu");
  if (menu) {
    const opened = () => { const circle = document.querySelector(`[data-rail-place="${menu}"]`); if (circle) circle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); else setTimeout(opened, 100); };
    opened();
  }
}
