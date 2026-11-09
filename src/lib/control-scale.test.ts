import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { DigestChip } from "@/components/DigestChip";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import type { Message } from "@/state/store";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
// windows checkouts can carry crlf line endings
const css = readFileSync(join(src, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector: string): Record<string, string> {
  const start = css.indexOf(`  ${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start)).replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(body.split(";").map((line) => line.trim()).filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
}

describe("control scale", () => {
  it("steps buttons 24, 28 and 32px on the control tokens with a centered medium label", () => {
    const base = rule(".ui-button,\n  .ui-icon-button");
    expect(base).toMatchObject({ "min-height": "var(--spacing-control)", "font-size": "var(--text-base)", "font-weight": "500", "line-height": "var(--text-base--line-height)", "align-items": "center" });
    expect(rule(".ui-button-sm,\n  .ui-icon-button-sm")).toMatchObject({ "min-height": "var(--spacing-control-sm)", "font-size": "var(--text-sm)" });
    expect(rule(".ui-button-lg,\n  .ui-icon-button-lg")).toMatchObject({ "min-height": "var(--spacing-control-lg)" });
    expect(rule(".ui-button-primary")).toMatchObject({ background: "var(--color-accent)", color: "var(--color-accent-ink)" });
    expect(rule(".ui-button-danger")).toMatchObject({ background: "var(--color-danger)", color: "var(--color-danger-ink)" });
    expect(css).toMatch(/--spacing-control-sm: 24px;\s+--spacing-control: 28px;\s+--spacing-control-lg: 32px;/);
  });

  it("grows every control to a 44px target on a touch screen", () => {
    const touch = css.slice(css.indexOf("A touch screen gets a 44px target"));
    expect(touch).toMatch(/\.ui-icon-button \{ min-height: var\(--spacing-touch\); \}/);
    expect(css).toContain("--spacing-touch: 44px;");
  });

  it("gives pills, fields and code one size each", () => {
    expect(rule(".ui-pill")).toMatchObject({ "min-height": "var(--spacing-control)", "border-radius": "9999px", "font-size": "var(--text-base)", "font-weight": "500", "align-items": "center" });
    expect(rule(".ui-field")).toMatchObject({ "min-height": "var(--spacing-control)", "border-radius": "var(--radius-lg)", "font-size": "var(--text-base)" });
    expect(rule(".ui-code-chip")).toMatchObject({ "box-decoration-break": "clone", "font-family": "var(--font-mono)", "font-size": "0.86em", "line-height": "1" });
  });

  it("keeps every step on tokens", () => {
    for (const selector of [".ui-button", ".ui-button-primary", ".ui-button-danger", ".ui-button-ghost", ".ui-pill", ".ui-field", ".ui-code-chip"]) {
      expect(Object.values(rule(selector)).join(" "), selector).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?!9999px)(?:[2-9]|\d{2,})px\b/i);
    }
  });

  it("is what the shared components render with", () => {
    expect(renderToStaticMarkup(createElement(Button, { variant: "primary", size: "sm" }, "Save"))).toBe('<button type="button" class="ui-button ui-button-primary ui-button-sm">Save</button>');
    expect(renderToStaticMarkup(createElement(Button, null, "Cancel"))).toBe('<button type="button" class="ui-button">Cancel</button>');
    expect(renderToStaticMarkup(createElement(IconButton, { label: "Close", icon: "×", size: "lg" })))
      .toBe('<button type="button" aria-label="Close" title="Close" class="ui-icon-button ui-icon-button-lg">×</button>');
    expect(renderToStaticMarkup(createElement(Input, { size: "sm" }))).toBe('<input class="ui-field ui-field-sm"/>');
  });

  it("is what the digest chip and inline code render with", () => {
    const message: Message = {
      id: "digest", role: "bot", kind: "digest", at: 1,
      digest: { turnId: "t", botId: "b", threadId: "th", at: 1, durationMs: 1, tools: [{ name: "Read", count: 2, failed: 0 }],
        files: { changed: [], added: [], deleted: [] }, memory: [], reply: "", hookCoverage: "preview" },
    };
    expect(renderToStaticMarkup(createElement(DigestChip, { message }))).toMatch(/class="inline-flex h-control-xs /);
    const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: "run `pnpm test` now" }));
    expect(html).toContain('class="ui-code-chip break-words [unicode-bidi:isolate]"');
    expect(html).not.toContain("text-base");
  });
});
