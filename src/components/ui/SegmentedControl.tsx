import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `radio` picks a setting; `tabs` switches the view below it. */
  kind?: "radio" | "tabs";
  size?: "sm" | "md";
  className?: string;
}

const nextIndex = (key: string, current: number, count: number) =>
  key === "ArrowRight" || key === "ArrowDown" ? (current + 1) % count
    : key === "ArrowLeft" || key === "ArrowUp" ? (current - 1 + count) % count
      : key === "Home" ? 0 : key === "End" ? count - 1 : -1;

/** A row of mutually exclusive choices on one track; the arrow keys move between them. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, kind = "radio", size = "md", className }: SegmentedControlProps<T>) {
  const tabs = kind === "tabs";
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const next = nextIndex(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
    if (next < 0) return;
    event.preventDefault();
    buttons[next]!.focus();
    buttons[next]!.click();
  };
  return (
    <div
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-fill p-0.5", size === "sm" ? "h-control-sm" : "h-control", className)}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={tabs ? "tab" : "radio"}
            {...(tabs ? { "aria-selected": on } : { "aria-checked": on })}
            tabIndex={on ? 0 : -1}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-full min-w-0 items-center justify-center rounded-md px-2.5 font-medium transition-colors motion-reduce:transition-none",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "text-sm" : "text-base",
              on ? "bg-raised text-ink shadow-sm" : "text-ink-secondary enabled:hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
