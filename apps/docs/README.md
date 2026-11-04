# Openpals documentation

The documentation site is a Next.js 16 + Fumadocs app. User-facing content lives in `content/docs`; the repository's top-level `docs` folder remains available for implementation notes and detailed platform records.

## Develop

From the repository root:

```bash
pnpm install
pnpm docs:dev
```

The site opens at `http://localhost:3000`.

## Verify

```bash
pnpm docs:build
pnpm --filter @openmausbot/docs types:check
pnpm --filter @openmausbot/docs lint
```

## Deploy

The site is a standard Next.js app: deploy `apps/docs` as the root directory of any Next.js host. It deploys only the
documentation, never the Electron app, local harness, credentials, agents or user data.
