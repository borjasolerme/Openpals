import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A surface that groups related controls: settings sections, panels on a page. */
export function Card({
  title,
  subtitle,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "rounded-xl bg-card p-4 max-md:rounded-2xl",
      "in-data-[settings-look=simple]:rounded-xl in-data-[settings-look=simple]:border-[0.5px] in-data-[settings-look=simple]:border-(--settings-edge) in-data-[settings-look=simple]:bg-menu",
      className,
    )}>
      {title && <div className="text-lg font-semibold text-ink in-data-[settings-look=simple]:font-medium">{title}</div>}
      {subtitle && <div className={cn(title && "mt-0.5", "text-base text-ink-secondary")}>{subtitle}</div>}
      {children && <div className={title || subtitle ? "mt-3" : undefined}>{children}</div>}
    </div>
  );
}
