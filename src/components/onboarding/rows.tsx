import { Children, type ReactNode } from "react";
import { Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/** A list of rows in one card, divided by hairlines. */
export const ROW_LIST = "flex flex-col divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/50";
export const ROW = "flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left";
/** A small text button under a list, for a way that is not the main one. */
export const QUIET = "w-fit rounded text-base text-ink-secondary transition-colors hover:text-ink";

export function RowIcon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill-subtle text-ink-secondary">{children}</span>;
}

export function RowText({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-lg font-medium leading-5 text-ink">{title}</span>
      {hint && <span className="truncate text-sm text-ink-secondary">{hint}</span>}
    </span>
  );
}

/** One row: an icon, a name and a line, what it is now or the button that does it, then anything it opens below. */
export function Row({ icon, title, hint, trailing, children, ...data }: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <div {...data}>
      <div className={ROW}>
        <RowIcon>{icon}</RowIcon>
        <RowText title={title} hint={hint} />
        {trailing}
      </div>
      {Children.toArray(children).length > 0 && <div className="flex flex-col gap-2 px-4 pb-3.5">{children}</div>}
    </div>
  );
}

export type StatusTone = "ok" | "busy" | "bad";

/** Where a row stands, on its right: Connected, Checking…, No answer. */
export function RowStatus({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span role="status" data-row-status={tone} className={cn("flex shrink-0 items-center gap-1.5 text-base leading-5",
      tone === "bad" ? "text-danger" : "text-ink-secondary")}>
      {tone === "ok" && <Check size={14} strokeWidth={2.5} aria-hidden="true" className="text-success" />}
      {tone === "busy" && <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />}
      {tone === "bad" && <CircleAlert size={14} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The one thing a row does, on its right: Sign in ›, Start ›. */
export function RowAction({ onClick, disabled = false, children, ...data }: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...data} className="ui-button shrink-0 gap-0.5 pr-2">
      {children}
      <ChevronRight size={14} aria-hidden="true" className="text-ink-secondary" />
    </button>
  );
}

/** A part of a step with a small heading and one line over its rows. */
export function Section({ title, line, children }: { title: string; line?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-medium leading-5 text-ink">{title}</h2>
        {line && <p className="text-sm text-ink-secondary [text-wrap:pretty]">{line}</p>}
      </div>
      {children}
    </section>
  );
}
