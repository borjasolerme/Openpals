import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function rowClass(selected = false, className?: string): string {
  return cn(
    "flex min-h-control w-full min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-start text-base text-ink touch:min-h-10",
    "transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
    selected ? "bg-fill" : "hover:bg-fill",
    className,
  );
}

export interface RowProps extends Omit<ComponentProps<"button">, "title"> {
  title: ReactNode;
  leading?: ReactNode;
  /** A second line in secondary ink. */
  hint?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

/** One row of a list or a navigation rail: leading icon, title, an optional hint under it, and a trailing slot. */
export function Row({ title, leading, hint, trailing, selected = false, className, type = "button", ...props }: RowProps) {
  return (
    <button type={type} className={rowClass(selected, className)} {...props}>
      {leading && <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-4">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {hint && <span className="truncate text-sm text-ink-secondary">{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}
