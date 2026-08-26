---
name: update-devops-tools
description: "Brings .claude/devops-tools.json back in step with a Terraform change, preserving the existing model's labels, notes and folding decisions. Use when the user runs /devops-tools:update-devops-tools, says their architecture diagram or DevOps Tools is out of date after editing Terraform, or when the DevOps Tools app reports the board file is invalid. Read-only with respect to Terraform: it never edits a .tf file and never calls AWS. For a project with no board yet, use init-devops-tools instead."
---

# Update DevOps Tools

Re-derive `.claude/devops-tools.json` from the current Terraform **as a diff**, not from scratch.

```
read existing board → read terraform → diff the resource sets
                   → carry forward labels/notes → layout → validate → report the change
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

**If `.claude/devops-tools.json` does not exist**, run `/devops-tools:init-devops-tools` instead.

## Workflow

### 1. Read the existing board, then the Terraform

Read `.claude/devops-tools.json` first, so you know what the previous pass decided before the
Terraform can bias you. Then read every `.tf` under `project.terraformRoot`, plus any local module
it calls.

If the Terraform has moved since the board was written, find it and update `project.terraformRoot`.

**Do not read `terraform.tfstate`, `*.tfvars`, or `.env`.**

If the board fails to parse at all — the app reported it invalid, or `JSON.parse` throws — say so,
and rebuild from the Terraform following `init-devops-tools`'s workflow. Salvage any `notes` and
`label` values you can still read out of the broken file.

### 2. Diff the resource sets

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

### 3. Re-check the things that move underneath you

Some properties are derived rather than declared, and a change elsewhere silently invalidates them:

- **Subnet tier.** Adding a `0.0.0.0/0` route to an internet gateway turns a `private_subnet` into
  a `public_subnet` without touching the `aws_subnet` block at all. Re-trace the routing.
- **Containment.** A resource that moved to a different subnet, or a subnet that moved AZ.
- **Folded attributes.** A new `aws_vpc_security_group_ingress_rule` does not add a node — it
  changes the `ingress` list on an existing security group node, and needs its own `folded` entry.
- **`source.line`.** Line numbers drift with every edit above them. Refresh them, or drop the
  `line` field rather than leave it pointing at the wrong place.

### 4. Lay out and validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/layout-board.mjs" .claude/devops-tools.json
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-board.mjs" .claude/devops-tools.json
```

Layout is a pure function of the graph, so you do not carry positions forward and you should not
try to — if the graph did not change, the file comes out byte-identical and `git diff` is empty. A
box that moved means a resource actually moved.

**If the validator fails, fix it and re-run both.** A dangling edge or `folded.into` after a
removal is the usual cause.

### 5. Report the change, not the file

The user already knows what their architecture looks like. What they want from you is what moved:

- **Added**: which resources became new boxes, and where they landed.
- **Removed**: what disappeared, and what edges went with it.
- **Changed**: attributes that differ, and especially any **role change** — a subnet that became
  public is a security-relevant fact, not a cosmetic one. Say it loudly.
- Anything you folded differently than last time, and why.
- `git diff --stat .claude/devops-tools.json`, so they can see the size of the change.

If nothing changed, say exactly that and confirm the diff is empty.
