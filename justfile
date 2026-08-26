# DevOps Tools — common developer commands.
# Run `just` from the repository root to list them.
#
# At the ROOT rather than in apps/devops-tools (where maestro keeps its equivalent), because this
# repo is one product in two halves: the commands you actually reach for span the app, the plugin's
# scripts, and the window probe that drives one against the other. A justfile inside the app could
# not name half of them.

set shell := ["bash", "-uc"]

# List available recipes
default:
    @just --list

# ── Setup ───────────────────────────────────────────────────────────────────

# Install workspace dependencies
install:
    pnpm install

# Needed once per install that re-extracts Electron, on Linux. Without it the app aborts with
# "The SUID sandbox helper binary was found, but is not configured correctly." Needs root, so this
# prints the commands rather than running them. Do NOT work around it with --no-sandbox: OS-level
# renderer isolation is a property test/isolation.test.ts spends four assertions defending.
#
# `just --list` shows only the LAST comment line before a recipe, hence the explicit [doc] here
# and on the other two recipes whose explanation runs long.
[doc("Print the sudo commands that fix the Electron sandbox helper's setuid bit (Linux)")]
sandbox-help:
    @echo "Run these, then re-run 'just dev':"
    @echo
    @echo "  sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
    @echo "  sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
    @echo
    @echo "Current state:"
    @ls -l node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox 2>/dev/null || echo "  (electron not installed — run 'just install')"

# ── Running the app ─────────────────────────────────────────────────────────

# Start the app in dev mode, HMR on the renderer, served over http://localhost
dev:
    pnpm dev

# Build the main/preload/renderer bundles into apps/devops-tools/out/
build:
    pnpm build

# Run the built app the way a real launch does: out/, loaded over file://
start: build
    pnpm --filter devops-tools start

# ── Checks ──────────────────────────────────────────────────────────────────

# Type-check both tsconfig projects (tsconfig.node.json, tsconfig.web.json)
typecheck:
    pnpm typecheck

# Check formatting without writing (prettier --check)
lint:
    pnpm check

# Fix formatting in place (prettier --write)
format:
    pnpm format

# Run the vitest suite
test:
    pnpm test

# lint + typecheck + test — the full pre-PR check
verify:
    pnpm verify

# Builds first, because this deliberately tests the file:// load that ships, not the dev server.
# See apps/devops-tools/.claude/skills/test-devops-tools/SKILL.md.
[doc("Drive the packaged app in a real Electron window and assert 24 things about it")]
probe: build
    node apps/devops-tools/.claude/skills/test-devops-tools/scripts/probe.mjs

# ── The plugin ──────────────────────────────────────────────────────────────

# Run after ANY edit to src/core/board-schema.ts, and commit the result. It fails quietly: the
# stale bundle keeps working and every test stays green, and the only symptom is that skills start
# validating boards against last month's rules.
[doc("Regenerate the CJS schema bundle the plugin's validator requires")]
build-plugin-libs:
    pnpm --filter devops-tools build:plugin-libs

# Check a board against the schema the app enforces. Defaults to the repo's own test fixture.
validate path="apps/devops-tools/test/fixtures/oli-board.json":
    node plugins/devops-tools/scripts/validate-board.mjs {{path}}

# Check the marketplace and plugin manifests. Run after editing either .claude-plugin/*.json —
# a malformed manifest fails at `claude plugin marketplace add` time, in someone else's terminal.
validate-plugin:
    claude plugin validate .
    claude plugin validate plugins/devops-tools

# Recompute every position and size in a board from its graph. Rewrites the file in place.
layout path="apps/devops-tools/test/fixtures/oli-board.json":
    node plugins/devops-tools/scripts/layout-board.mjs {{path}}

# ── Housekeeping ────────────────────────────────────────────────────────────

# Remove build output and turbo's local cache. Leaves node_modules alone.
clean:
    rm -rf apps/devops-tools/out .turbo apps/devops-tools/.turbo
