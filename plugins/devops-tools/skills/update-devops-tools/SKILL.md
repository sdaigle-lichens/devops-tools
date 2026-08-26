---
name: update-devops-tools
description: "Brings .claude/devops-tools.json back in step with a Terraform change, preserving the existing model's labels, notes and folding decisions. Use when the user runs /devops-tools:update-devops-tools, says their architecture diagram or DevOps Tools is out of date after editing Terraform, or when the DevOps Tools app reports the board file is invalid. Read-only with respect to Terraform: it never edits a .tf file and never calls AWS. For a project with no board yet, use init-devops-tools instead."
---

# Update DevOps Tools

Re-derive `.claude/devops-tools.json` from the current Terraform **as a diff**, not from scratch.

```
check the board's layout matches the project's shape → read existing board → read terraform
    → diff the resource sets → carry forward labels/notes → layout → validate → report the change
```

The existing board carries decisions worth keeping: labels a human corrected, `notes` explaining
why something is the way it is, and folding calls the user has already reviewed. Regenerating from
zero throws all of that away and produces a large, unreadable diff. Do not do that.

**This skill never modifies Terraform and never contacts AWS.**

## User's intention

$ARGUMENTS

## Before you start

Read `${CLAUDE_PLUGIN_ROOT}/reference/schema.md` in full — the field list, the folding tables, the
containment rules.

**If neither `.claude/devops-tools.json` nor `.claude/devops-tools/` exists**, run
`/devops-tools:init-devops-tools` instead.

**If you delegate any part of this workflow to a subagent**, its task prompt must say to read this
file, or must include Step 1 below verbatim — a subagent given a shortened prompt like "diff-update
the board" has no way to know a migration check exists at all, and will happily keep a
three-environment project on one merged board forever.

## Workflow

Everything from Step 2 on describes updating **one** board. Run it once per file when the project
has more than one environment (`.claude/devops-tools/<id>.json` for each) — each is independent, so
a change to `bxl-dev`'s tfvars only touches `bxl-dev.json`.

Check whether your environment offers task-tracking tools (`TaskCreate`/`TaskUpdate` or similar). If
so, create one item per numbered step below — Step 1 especially — and mark each done as you go.
This is a second, independent layer on top of the note above about delegation: a checklist only
helps if the step was in the prompt to begin with, but for the agent actually doing the work it is
real insurance against reading past a step it did see.

**If they are not available, say so before proceeding rather than quietly working around it.**
These tools are known to intermittently fail to register even when they should be
([anthropics/claude-code#80401](https://github.com/anthropics/claude-code/issues/80401)) — that is
a session-level gap, not something this skill caused or can fix. Tell the user plainly that the
checklist safety net is unavailable this session, and ask whether to proceed anyway (working the
numbered steps in order without it — Step 1's migration check does not depend on it and must still
happen) or stop here and restart their session in case the tools reconnect. Don't decide this for
them and don't bury it in other output.

### 1. Check the board is in the right layout — every run, not just when something changed

```bash
ls terraform/env/*.tfvars environments/*.tfvars 2>/dev/null   # or wherever this project keeps them
ls .claude/devops-tools.json .claude/devops-tools/ 2>/dev/null
```

Compare what the project **currently** has against what the board **currently** is:

- More than one environment (several `*.tfvars` files, or more than one independent root module)
  but only the single `.claude/devops-tools.json` exists → **stop.** This run is a migration, not
  an update. Go to [Migrating the layout](#migrating-the-layout) and do not come back to Step 2.
- Exactly one environment but `.claude/devops-tools/` exists with boards in it → same: stop, go
  migrate down to the single file.
- Otherwise, the layout already matches — continue to Step 2.

**Do not condition this on whether the mismatch is new.** There is no way to tell "a second
environment just appeared" from "this project has had three `.tfvars` files since before this
skill supported more than one" — the board is a snapshot, not a history. A project can fail this
check the first time `update-devops-tools` runs after this feature shipped, for tfvars files that
have existed for years. Treat every mismatch the same: fix it now.

### 2. Read the existing board, then the Terraform

Read the board first, so you know what the previous pass decided before the Terraform can bias
you. Then read every `.tf` under `project.terraformRoot`, plus any local module it calls.

If the Terraform has moved since the board was written, find it and update `project.terraformRoot`.

**Do not read `terraform.tfstate`, `*.tfvars`, or `.env`.** If a shared-root project's environments
changed which flags they enable, ask the user rather than reading the tfvars — same rule as
`init`, see `reference/schema.md`'s "Multiple environments" section.

If the board fails to parse at all — the app reported it invalid, or `JSON.parse` throws — say so,
and rebuild from the Terraform following `init-devops-tools`'s workflow. Salvage any `notes` and
`label` values you can still read out of the broken file.

### 3. Diff the resource sets

Build the current set of Terraform addresses (expanding `for_each`/`count` the same way
`reference/schema.md` describes) and compare it against the board's `nodes[].id` plus
`folded[].address`. Three buckets:

- **Unchanged** — the address is in both. Carry the node forward **verbatim**, then update only the
  `attributes` that the Terraform actually changed. Keep `label`, `notes`, `summary`, `service` and
  `role` exactly as they are: a human may have corrected them.
- **Added** — new in the Terraform. Classify it fresh (node / attribute / edge / dropped), and
  insert it near its siblings rather than at the end, so the diagram's reading order stays sane.
- **Removed** — in the board, gone from the Terraform. Delete the node, and delete every edge and
  `folded` entry that referenced it. **Do not leave a dangling reference** — the validator will
  reject the file, and it is the single most common way this skill produces a broken board.

### 4. Re-check the things that move underneath you

Some properties are derived rather than declared, and a change elsewhere silently invalidates them:

- **Subnet tier.** Adding a `0.0.0.0/0` route to an internet gateway turns a `private_subnet` into
  a `public_subnet` without touching the `aws_subnet` block at all. Re-trace the routing.
- **Containment.** A resource that moved to a different subnet, or a subnet that moved AZ.
- **Folded attributes.** A new `aws_vpc_security_group_ingress_rule` does not add a node — it
  changes the `ingress` list on an existing security group node, and needs its own `folded` entry.
- **`source.line`.** Line numbers drift with every edit above them. Refresh them, or drop the
  `line` field rather than leave it pointing at the wrong place.

### 5. Lay out and validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/layout-board.mjs" <path>
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-board.mjs" <path>
```

Layout is a pure function of the graph, so you do not carry positions forward and you should not
try to — if the graph did not change, the file comes out byte-identical and `git diff` is empty. A
box that moved means a resource actually moved.

**If the validator fails, fix it and re-run both.** A dangling edge or `folded.into` after a
removal is the usual cause.

### 6. Report the change, not the file

The user already knows what their architecture looks like. What they want from you is what moved:

- **Added**: which resources became new boxes, and where they landed.
- **Removed**: what disappeared, and what edges went with it.
- **Changed**: attributes that differ, and especially any **role change** — a subnet that became
  public is a security-relevant fact, not a cosmetic one. Say it loudly.
- Anything you folded differently than last time, and why.
- `git diff --stat .claude/devops-tools.json`, so they can see the size of the change.

If nothing changed, say exactly that and confirm the diff is empty.

## Migrating the layout

A project can move between "one environment" and "several" over time. Handle it explicitly rather
than silently:

- **More than one environment exists** (several `*.tfvars` files, or more than one independent
  root module) **but the board is still the single `.claude/devops-tools.json`** — whether that
  second environment just appeared or has been there all along and simply predates this skill
  supporting more than one: tell the user, confirm you should switch to
  `.claude/devops-tools/<id>.json` per environment, build each board following
  `init-devops-tools`'s workflow (carrying forward whatever the existing single file already got
  right for the environment it matches), and ask before deleting the old single file — leaving
  both around gives the app two disagreeing sources for one project.
- **Down to one environment** (environments merged, or all but one root module removed): confirm
  with the user, write the single `.claude/devops-tools.json`, and ask before removing the
  `.claude/devops-tools/` directory.

Never do this migration silently as a side effect of an unrelated update — it changes where the
board lives, which is a bigger change than the diff it usually produces.
