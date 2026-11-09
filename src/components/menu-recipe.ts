export const MENU_SHEET = "popover-surface flex flex-col gap-1 rounded-[var(--radius-menu)] border border-hairline/50 bg-menu p-1.5 shadow-base [&_svg.lucide]:stroke-[1.5]";

export const MENU_ITEM = "flex min-h-7.5 w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-lg leading-4.5 focus-visible:bg-menu-hover";

export const MENU_ITEM_SEPARATOR = "mx-1.5 h-px shrink-0 bg-hairline/50";

export const MENU_HEADING = "px-2 pb-1 pt-2 text-sm font-medium text-ink-secondary";

export const MENU_ROW =
  "group flex h-7.5 w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-left text-base text-ink hover:bg-fill focus:bg-fill active:bg-fill disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent touch:h-10";

/** Simple mode's rows pair a model name with a second line, so they grow with it instead of clipping at 30px. */
export const SIMPLE_MENU_ROW =
  "group flex min-h-7.5 w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2 py-1 text-left text-base text-ink hover:bg-fill focus:bg-fill active:bg-fill disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent touch:min-h-10";

export const SIMPLE_MENU_META = "min-w-0 max-w-full truncate text-sm text-ink-tertiary";

export const MENU_LINE = "flex h-7.5 w-full min-w-0 shrink-0 items-center gap-2 px-2 text-base touch:h-10";

export const MENU_GUTTER = "flex size-4 shrink-0 items-center justify-center";

export const MENU_META = "min-w-0 max-w-[45%] shrink truncate text-sm text-ink-tertiary";

export const MENU_LABEL = "flex h-6 shrink-0 items-end gap-2 px-2 pb-0.5 text-sm font-medium text-ink-tertiary";

export const MENU_SEPARATOR = "mx-2 my-1 h-[0.5px] shrink-0 bg-fill";

export const MENU_NOTE = "px-2 py-1 text-sm text-ink-tertiary";

export const MENU_ICON = "shrink-0 text-ink-secondary";

export const MENU_TRAILING = "shrink-0 text-ink-tertiary rtl:-scale-x-100";

export const MENU_STROKE = 1.75;

/** Arrow keys, Home and End move focus through a menu's enabled buttons, wrapping at either end. */
export function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
