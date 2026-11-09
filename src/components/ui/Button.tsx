import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** sm 24px, md 28px (the default for rows and dialogs), lg 32px. */
export type ControlSize = "sm" | "md" | "lg";

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** A pill instead of the skin's control radius. */
  pill?: boolean;
}

/** The button's classes, for an `<a>` or `<label>` that must look like one. */
export function buttonClass({ variant = "secondary", size = "md", pill = false }: ButtonLook = {}, className?: string): string {
  return cn(
    "ui-button",
    variant !== "secondary" && `ui-button-${variant}`,
    size !== "md" && `ui-button-${size}`,
    pill && "rounded-full",
    className,
  );
}

export function Button({ variant, size, pill, className, type = "button", ...props }: ComponentProps<"button"> & ButtonLook) {
  return <button type={type} className={buttonClass({ variant, size, pill }, className)} {...props} />;
}
