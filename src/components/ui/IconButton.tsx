import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ControlSize } from "./Button";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label"> {
  /** What the button does, read by screen readers and shown as its tooltip. */
  label: string;
  icon: ReactNode;
  size?: ControlSize;
  /** Drawn as switched on: the accent ink, as a toggled panel. */
  active?: boolean;
}

export function iconButtonClass(size: ControlSize = "md", className?: string): string {
  return cn("ui-icon-button", size !== "md" && `ui-icon-button-${size}`, className);
}

/** A square ghost button holding one icon; `label` is its accessible name and tooltip. */
export function IconButton({ label, icon, size = "md", active = false, className, type = "button", title, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={iconButtonClass(size, cn(active && "text-accent enabled:hover:text-accent", className))}
      {...props}
    >
      {icon}
    </button>
  );
}
