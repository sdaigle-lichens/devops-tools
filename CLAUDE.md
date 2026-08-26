# devops-tools

A pnpm/Turborepo monorepo **and** a Claude Code plugin marketplace, in one repository, because the
two halves are a single product: the plugin's skills write `.claude/devops-tools.json` into a
user's project, and `apps/devops-tools` is what renders it.

- `apps/devops-tools` — the Electron app. See its `CLAUDE.md` for the process boundary.
- `plugins/devops-tools` — the skills (`init-devops-tools`, `update-devops-tools`), the schema
  reference they follow, and the `layout-board.mjs` / `validate-board.mjs` scripts they run.
- `.claude-plugin/marketplace.json` — the manifest, and the source of truth for what is published.
- `packages/*` — `@repo/styles` (Tailwind v4 theme), `@repo/typescript-config`.

## The two rules

**Read-only.** The app never writes to a user's repository, never calls AWS, and makes no network
request. The one module allowed to write anything is `src/main/project-store.ts`, and it writes the
app's own state into `app.getPath("userData")`. `apps/devops-tools/test/isolation.test.ts` asserts
this by scanning source text — if you need a new write, that test is the conversation.

**One schema.** `apps/devops-tools/src/core/board-schema.ts` defines the board format. The
plugin's `scripts/lib/board-schema.cjs` is **generated** from it by
`apps/devops-tools/scripts/build-plugin-libs.mjs`; run

```bash
pnpm --filter devops-tools build:plugin-libs
```

after touching the schema, and commit the result. It fails quietly: the stale bundle keeps working
and every test stays green, and the only symptom is that skills start validating against last
month's rules.

## Layout belongs to the plugin, not the app

`plugins/devops-tools/scripts/layout-board.mjs` computes every position and size from the graph.
The app renders what it is given and never computes a layout — which is what makes the committed
file stable: re-running the update skill against unchanged Terraform produces a byte-identical file
and an empty `git diff`. Do not add a layout library to the app.

## Commands

```bash
pnpm dev        # turbo → electron-vite dev
pnpm verify     # prettier --check + both typechecks + vitest
pnpm build
```
