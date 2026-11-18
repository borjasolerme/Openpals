import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs build script, without declarations
import { rewriteDeclaration } from "../scripts/declaration-imports.mjs";

describe("published declarations", () => {
  it("import the .js files the build emits, never .ts sources", () => {
    expect(rewriteDeclaration('export { a } from "./types.ts";\nimport type { B } from "../cua/wire.ts";\ntype C = import("./web/rules.ts").D;\nimport "zod";'))
      .toBe('export { a } from "./types.js";\nimport type { B } from "../cua/wire.js";\ntype C = import("./web/rules.js").D;\nimport "zod";');
  });
});
