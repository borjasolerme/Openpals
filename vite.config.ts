import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { hostTimeout } from "./server/testing/host-timeout.ts";

// The About dialog's version, inlined at build time: the preload bridge is
// absent in dev.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

const E2E_FILES = ["**/*.e2e.test.ts"];
const E2E_WORKERS = Math.max(1, Number(process.env.OMB_E2E_WORKERS) || 1);

const include = [
  "evals/**/*.test.ts",
  "server/**/*.test.ts",
  "electron/**/*.test.mjs",
  "src/**/*.test.ts",
  "shared/**/*.test.ts",
  "companion/**/*.test.ts",
  "scripts/**/*.test.mjs",
  "scripts/**/*.test.ts",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    setupFiles: ["server/testing/setup.ts", "src/testing/all-locales.ts"],
    // Doubled on Windows, whose runners are about 1.45x slower.
    testTimeout: hostTimeout(20_000),
    hookTimeout: hostTimeout(30_000),
    // `vitest run` runs both, unit first; `--project unit` or `--project e2e` runs one.
    projects: [
      // Some unit files still spawn fake CLIs or a server: half the cores leaves them room.
      { extends: true, test: { name: "unit", include, exclude: [...configDefaults.exclude, ...E2E_FILES], maxWorkers: "50%" } },
      // An e2e file boots a real harness server and spawns a fake CLI per turn, so several at once starve each other's
      // waits; they run one by one unless OMB_E2E_WORKERS asks for more on a quiet machine.
      { extends: true, test: { name: "e2e", include: E2E_FILES, maxWorkers: E2E_WORKERS, sequence: { groupOrder: 1 } } },
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: Number(process.env.OMB_UI_PORT) || 5199,
    // packager output lands inside the repo — its HTML files must never
    // trigger dev full-page reloads
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        ws: true,
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8799}`,
      },
      "/.well-known/openmausbot/environment": {
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8799}`,
      },
    },
  },
});
