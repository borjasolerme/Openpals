import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EngineGroupLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-xs font-medium uppercase tracking-caps text-ink-secondary",
        className,
      )}
    >
      {children}
    </div>
  );
}
