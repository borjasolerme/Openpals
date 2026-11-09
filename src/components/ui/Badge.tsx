import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "outline" | "accent" | "success" | "warning" | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-fill text-ink-secondary",
  outline: "border border-hairline/40 bg-panel text-ink-secondary",
  accent: "bg-accent/12 text-accent-text",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

/** A static label: a role, a count, a status. 20px high, never a control. */
export function Badge({ tone = "neutral", icon, className, children, ...props }: ComponentProps<"span"> & { tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <span
      className={cn("inline-flex h-control-xs min-w-0 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-sm font-medium", TONES[tone], className)}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
