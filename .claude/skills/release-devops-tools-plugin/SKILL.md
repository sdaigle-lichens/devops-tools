---
name: release-devops-tools-plugin
description: "Ship a change under plugins/devops-tools/ so the installed plugin actually runs it — regenerate the schema bundle, bump plugin.json's version, push, and update the install. Use when finishing an edit under plugins/devops-tools/ (a SKILL.md, reference/schema.md, or scripts/), or when asked to release, publish, ship, or update the devops-tools marketplace/plugin."
---

# Release the devops-tools plugin

The marketplace this repo publishes is **GitHub-sourced**, not a local path — check
`~/.claude/plugins/known_marketplaces.json` if in doubt, it names `source: "github"`. That means an
edit under `plugins/devops-tools/` is invisible to the installed plugin until it is pushed, and the
installed copy is cached on disk keyed by `plugin.json`'s `version` — so pushing without bumping
that version can leave `claude plugin marketplace update` with nothing new to show, and the user
re-runs a skill believing it changed when the cache never moved. That is exactly what happened the
first time this loop was needed: `SKILL.md` files and `reference/schema.md` changed, got committed
and pushed, and the installed plugin kept running the stale cached copy because nothing bumped the
version or told the user to pull it.

Run this checklist before calling a `plugins/devops-tools/` change done — not just after a schema
change, after any edit under that directory:

## 1. Regenerate the plugin bundle, if `board-schema.ts` changed

```bash
pnpm --filter devops-tools build:plugin-libs
git diff --stat plugins/devops-tools/scripts/lib/
```

This step **fails quietly** (see `apps/devops-tools/CLAUDE.md`): skip it after a real schema change
and every test still passes, `git diff` on the `.cjs` bundle stays empty, and the only symptom is
that the init/update skills go on validating boards against last month's rules. If you touched
`board-schema.ts` and the diff above comes back empty, something is wrong — re-run it, don't assume
the schema didn't actually change.

## 2. Validate the marketplace

```bash
claude plugin validate .
```

Catches a malformed `plugin.json` or `marketplace.json` before it reaches GitHub.

## 3. Bump `plugins/devops-tools/.claude-plugin/plugin.json`'s `version`

**This is the step that gets skipped, and the actual point of this skill.** Ordinary semver
judgement: patch for wording/doc-only edits, minor for a new capability (a schema field, new skill
behaviour, a new script flag), major for something that breaks an existing board or workflow.
`marketplace.json`'s own top-level `metadata.version` is a separate, coarser number for the catalog
itself — bump it too on a change big enough to be worth mentioning at that level, but the plugin
version is the one that actually gates the cache and is required every time.

## 4. Commit and push to `main`

The marketplace tracks the pushed branch, not the working tree. A local commit that never reaches
GitHub is exactly as invisible to the installed plugin as an uncommitted edit.

## 5. Tell the user how to pull it — offer these, don't run them unasked

```bash
claude plugin marketplace update devops-tools    # re-pulls the catalog from GitHub
claude plugin update devops-tools@devops-tools   # updates the installed copy
```

Then **restart Claude Code** — plugin updates apply on restart, not live. Confirm it landed with
`claude plugin list`, which should show the version bumped in step 3. If it still shows the old
version after a restart, the push in step 4 or the marketplace update didn't actually happen —
don't assume the skill content changed just because the commands ran without error.
