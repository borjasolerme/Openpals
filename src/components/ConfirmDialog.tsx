import { useRef, type ReactNode, type RefObject } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./ui/Button";
import { Dialog, DialogFooter, DialogPanel } from "./ui/Dialog";

export type ConfirmTone = "danger" | "neutral";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** The way out, "Cancel" unless given. */
  cancelLabel?: string;
  tone?: ConfirmTone;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  /** A gentler way to the same end, offered beside the confirm button ("Archive instead"). */
  alternative?: { label: string; onClick: () => void };
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Cancel is focused by default so a stray Enter never confirms. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={props.open} onClose={props.onCancel} initialFocusRef={cancelRef} returnFocusRef={props.returnFocusRef} busy={props.pending}>
      {(panelRef) => <ConfirmDialogCard ref={panelRef} cancelRef={cancelRef} {...props} />}
    </Dialog>
  );
}

export function ConfirmDialogCard({
  ref,
  cancelRef,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  icon,
  onCancel,
  onConfirm,
  alternative,
  pending = false,
}: ConfirmDialogProps & {
  ref?: React.Ref<HTMLDivElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const danger = tone === "danger";
  return (
    <DialogPanel
      ref={ref}
      role="alertdialog"
      aria-busy={pending}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
      className={cn(danger && "border-danger/30")}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", danger ? "text-danger" : "text-warning")}>
          {icon ?? <AlertTriangle size={18} />}
        </span>
        <div className="min-w-0">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <p id="confirm-dialog-body" className="mt-1 text-base text-ink-secondary">
            {body}
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        {alternative && <Button variant="primary" data-confirm-alternative onClick={alternative.onClick} disabled={pending}>{alternative.label}</Button>}
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogPanel>
  );
}
