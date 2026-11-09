import { Settings } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { captionChrome, useDesktopCapabilities, windowFramed } from "./DesktopCapabilities";

/** A button in the frame's top bar: small, quiet, the bar's height and no more. */
export const FRAME_BAR_BUTTON = "flex size-5.5 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-fill hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** The window frame's top bar (windowFramed), as thin as the traffic lights allow: they sit in it on macOS (main puts
 * them there: electron/window-chrome.mjs), the caption buttons on Windows (WindowCaptionButtons, drawn over its right
 * end). The app's settings close the right end. The whole bar drags the window. */
export function WindowFrameBar() {
  const { capabilities } = useDesktopCapabilities();
  const { dispatch } = useStore();
  if (!windowFramed(capabilities)) return null;
  const mac = capabilities.windowChrome === "mac-inset";
  const { dragProps } = captionChrome(capabilities.windowChrome);
  return (
    <div data-window-frame-bar {...dragProps} className="flex h-7 shrink-0 items-center justify-end bg-frame">
      <div data-frame-bar-end className={cn("flex items-center gap-0.5", mac ? "pr-2" : "pr-35")}>
        <button
          type="button"
          data-frame-settings
          aria-label={t("sidebar.appSettings")}
          title={t("sidebar.appSettings")}
          onClick={() => dispatch({ type: "toggleAppSettings", open: true })}
          className={FRAME_BAR_BUTTON}
        >
          <Settings size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
