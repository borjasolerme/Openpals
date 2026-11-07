import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export const PRIMARY = "ui-button ui-button-pill ui-button-lg ui-button-primary min-w-[120px]";
export const SECONDARY = "ui-button ui-button-pill ui-button-lg";
export const QUIET = "rounded text-[13px] text-ink-secondary transition-colors hover:text-ink";

/** Where the person is among the steps between the welcome and the end. */
export interface StepProgress {
  current: number;
  total: number;
}

/** One screen of the first run: where it is, a picture, a title and one line, what the step asks, then Back and the
 * step's own actions. Centered while it fits; a long step scrolls with room above and below. */
export function StepFrame({ progress, art, title, line, centered = false, onBack, actions, children }: {
  progress?: StepProgress | null;
  art?: ReactNode;
  title: string;
  line?: ReactNode;
  centered?: boolean;
  onBack?: () => void;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("animate-fade-in m-auto flex w-full max-w-[540px] flex-col px-4 py-14 sm:px-6", centered && "items-center text-center")}>
      {progress && (
        <p data-welcome-progress="" className="mb-3 text-[12px] leading-4 text-ink-tertiary">
          {t("onboarding.tour.progress", { current: progress.current, total: progress.total })}
        </p>
      )}
      {art && <div className="mb-5 flex">{art}</div>}
      <h1 id="welcome-title" className="text-[26px] font-normal leading-[32px] tracking-[-0.02em] text-ink [text-wrap:balance]">{title}</h1>
      {line && <p className="mt-2 text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{line}</p>}
      {children && <div className="mt-6 w-full">{children}</div>}
      <div className={cn("mt-8 flex w-full items-center gap-3", centered && !onBack ? "justify-center" : "justify-between")}>
        {onBack && <button type="button" onClick={onBack} className={SECONDARY}>{t("onboarding.back")}</button>}
        <div className="flex items-center gap-4">{actions}</div>
      </div>
    </div>
  );
}

/** A choice on a step: an icon, a name and one line, pressed as a whole. */
export function ChoiceButton({ icon, title, hint, done = false, onClick, ...rest }: {
  icon: ReactNode;
  title: string;
  hint: string;
  done?: boolean;
  onClick: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button type="button" onClick={onClick} {...rest}
      className={cn("flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-ink/[0.04]",
        done ? "border-success/40" : "border-hairline/40")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-ink-secondary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-medium leading-5 text-ink">{title}</span>
        <span className="text-[13px] leading-[18px] text-ink-secondary">{hint}</span>
      </span>
    </button>
  );
}
