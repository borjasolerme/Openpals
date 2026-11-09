import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  /** Escape and a click on the scrim. */
  onClose: () => void;
  /** Focused on open, and again whenever `busy` clears; the panel itself otherwise. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Focused on close when the element that opened the dialog has gone. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** While busy the panel holds focus, so a key press cannot reach a disabled button. */
  busy?: boolean;
  children: (panelRef: RefObject<HTMLDivElement | null>) => ReactNode;
}

const focusable = (panel: HTMLElement | null) => panel?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]");

/**
 * A modal dialog: portalled to <body> (a translated ancestor would otherwise become its containing block), focus kept
 * inside it, Escape and the scrim close it, and focus returns to its opener.
 */
export function Dialog({ open, onClose, initialFocusRef, returnFocusRef, busy = false, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable(panelRef.current);
      if (!controls?.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = opener?.isConnected && opener !== document.body ? opener : returnFocusRef?.current;
      target?.focus();
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    if (busy || !initialFocusRef?.current) panelRef.current?.focus();
    else initialFocusRef.current.focus();
  }, [open, busy, initialFocusRef]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div aria-hidden="true" className="ui-scrim absolute inset-0" onMouseDown={() => close.current()} />
      {children(panelRef)}
    </div>,
    document.body,
  );
}

/** The dialog's surface: the menu tone on a hairline, 420px wide unless told otherwise. */
export function DialogPanel({ className, role = "dialog", ...props }: ComponentProps<"div">) {
  return <div role={role} tabIndex={-1} aria-modal="true" className={cn("ui-modal relative w-full max-w-105 p-5 shadow-lg outline-none", className)} {...props} />;
}

/** The dialog's actions, at its end: the way out first, the confirming action last. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-5 flex flex-wrap justify-end gap-2", className)} {...props} />;
}
