import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MenuItemProps extends Omit<ComponentProps<"button">, "children" | "value"> {
  label: ReactNode;
  icon?: ReactNode;
  /** A second line in secondary ink, cut to one line. */
  subtitle?: ReactNode;
  /** A second line that wraps: a caveat or a reason. */
  note?: ReactNode;
  /** The row's current value, at its end. */
  value?: ReactNode;
  trailing?: ReactNode;
  /** Drawn as the open or chosen row. */
  active?: boolean;
  tone?: "default" | "danger";
  /** A sentence that wraps instead of being cut short. */
  wrap?: boolean;
  /** Opens a submenu or another view. */
  chevron?: boolean;
}

/** One row of a menu: a 28px control (40px on touch) with an icon, a label and whatever ends it. */
export function MenuItem({
  label, icon, subtitle, note, value, trailing, active = false, tone = "default", wrap = false, chevron = false,
  className, type = "button", role = "menuitem", ...props
}: MenuItemProps) {
  const danger = tone === "danger";
  return (
    <button
      type={type}
      role={role}
      className={cn(
        "flex min-h-control w-full items-center gap-2 rounded-md px-2 py-1 text-start text-base touch:min-h-10",
        "focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-60",
        active ? "bg-menu-active" : "enabled:hover:bg-menu-hover",
        danger ? "text-danger" : "text-ink",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className={cn("flex size-4 shrink-0 items-center justify-center [&>svg]:size-4", wrap && "h-4.5 self-start",
          danger ? "text-danger" : active ? "text-accent" : "text-ink-secondary")}>
          {icon}
        </span>
      )}
      {subtitle || note ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={wrap ? "break-words" : "truncate"}>{label}</span>
          {subtitle && <span className="truncate text-sm text-ink-secondary">{subtitle}</span>}
          {note && <span className="text-sm text-ink-tertiary">{note}</span>}
        </span>
      ) : (
        <span className={cn("flex-1", wrap ? "min-w-0 break-words" : "truncate")}>{label}</span>
      )}
      {value !== undefined && value !== "" && <span className="shrink-0 tabular-nums text-ink-secondary">{value}</span>}
      {trailing}
      {chevron && <ChevronRight size={14} aria-hidden className="-me-0.5 shrink-0 text-ink-secondary rtl:-scale-x-100" />}
    </button>
  );
}
