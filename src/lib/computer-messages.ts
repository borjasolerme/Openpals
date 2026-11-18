import { t } from "./i18n";
import type { LocaleKey } from "@/locales";

/** A Computer panel error worded by locale key, so it is translated when shown rather than when thrown. */
export class LocalizedPanelError extends Error {
  constructor(
    readonly key: LocaleKey,
    readonly problem?: string | null,
    readonly fallbackKey?: LocaleKey,
  ) {
    super(key);
  }
}

export function panelErrorText(error: Error | string | null): string | null {
  if (error instanceof LocalizedPanelError) {
    return t(error.key, error.fallbackKey ? { problem: error.problem ?? t(error.fallbackKey) } : undefined);
  }
  return error instanceof Error ? error.message : error;
}
