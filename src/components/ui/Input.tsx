import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import type { ControlSize } from "./Button";

export function fieldClass(size: ControlSize = "md", className?: string): string {
  return cn("ui-field", size !== "md" && `ui-field-${size}`, className);
}

/** A one-line text field at a control height. */
export function Input({ size = "md", className, ...props }: Omit<ComponentProps<"input">, "size"> & { size?: ControlSize }) {
  return <input className={fieldClass(size, className)} {...props} />;
}

/** A multi-line text field in the same look; it grows from `rows` and scrolls past its `max-h-*`. */
export function TextArea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={fieldClass("md", cn("block resize-y py-1.5", className))} {...props} />;
}
