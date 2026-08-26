---
name: init-devops-tools
description: "Reads this project's Terraform and writes .claude/devops-tools.json — the committed model of its AWS architecture that the DevOps Tools desktop app draws as a diagram. Use when the user runs /devops-tools:init-devops-tools, asks to map or visualize their AWS architecture, or when the DevOps Tools app shows 'No board yet' for a project. Read-only with respect to Terraform: it never edits a .tf file and never calls AWS. For a project that already has a board, use update-devops-tools instead."
---

# Init DevOps Tools

Turn a project's Terraform into `.claude/devops-tools.json`: the condensed, nested model of its AWS
architecture that the DevOps Tools desktop app renders.

```
find terraform → read every .tf → decide what is a box → build the graph
              → layout-board.mjs → validate-board.mjs → report
```

**This skill never modifies Terraform and never contacts AWS.** It reads `.tf` files and writes one
JSON file. If the user asks for an infrastructure change while you are here, do that as separate,
explicit work — not as a side effect of drawing a picture.

## User's intention

$ARGUMENTS

## Before you start

Read `${CLAUDE_PLUGIN_ROOT}/reference/schema.md` in full. It is the contract: the field list, which
resource types become boxes, which fold into a parent, which become edges, and how `for_each`
expands. Everything below assumes you have it in context.

**If `.claude/devops-tools.json` already exists**, stop and run `/devops-tools:update-devops-tools`
instead — it preserves the existing model's decisions rather than re-deriving them. Only continue
here if the user explicitly asks to start over.

## Workflow

### 1. Find the Terraform

```bash
find . -name "*.tf" -not -path "*/.terraform/*" -not -path "*/node_modules/*" | head -50
```

The common roots are `infra/`, `terraform/`, `deploy/`, or the repository root. If there are
several independent root modules (say `infra/prod` and `infra/staging`), **ask the user which one
to map** — a board describes one architecture, and merging two environments into one diagram
produces something that describes neither.

Record the answer as `project.terraformRoot`, repo-relative.

Confirm it is AWS. If the `provider` blocks name no `aws` provider, say so and stop: this tool is
AWS-only, and a board full of `external` nodes helps nobody.

### 2. Read everything, including modules

Read every `.tf` under the chosen root — `main.tf`, `network.tf`, `variables.tf`, `outputs.tf`, and
any local `modules/*/` the root calls. `variables.tf` matters: a `default` is often the only
concrete value you will ever see.

**Do not read `terraform.tfstate`, `*.tfvars`, or `.env`.** They hold resolved secrets, and the
file you are writing gets committed.

Read the comments as carefully as the code. In good Terraform the comments carry the reasoning —
why there is no NAT gateway, why a security group has no port 22 rule — and that reasoning is
exactly what belongs in a node's `notes`. It is the part of the architecture a diagram normally
loses.

### 3. Decide what is a box

Go resource by resource and sort each into: a node, an attribute of another node, an edge, or
dropped. `reference/schema.md` has the tables. The judgement calls that matter:

- A real project is mostly attachment resources. Expect to fold more than you keep — in a typical
  network module, half the `resource` blocks are rules, routes and associations.
- Fold a configuration resource into its parent as a **readable** attribute, not a transcription.
  Four `aws_vpc_security_group_ingress_rule` blocks become
  `"ingress": ["tcp/80 from cloudflare-v4", "tcp/443 from cloudflare-v4", …]`, not four nested
  objects.
- **Every resource you do not turn into a node needs a `folded[]` entry.** This is what makes a
  condensed diagram checkable. No silent drops.

### 4. Build the containers

VPC → availability zone → subnet, as `reference/schema.md` describes. Availability zones are
synthetic containers you invent (`az.a`, `az.b`) — Terraform has no resource for them.

A subnet is `public_subnet` when its route table has a default route to an internet gateway,
`private_subnet` otherwise. Trace the actual `aws_route` and `aws_route_table_association`
resources to decide; fall back to `map_public_ip_on_launch` or a `Tier` tag only if the routing
is undeterminable, and record the assumption in `notes`.

### 5. Write the file

Emit placeholder geometry — `"position": {"x": 0, "y": 0}` on every node,
`"size": {"width": 220, "height": 96}` on every container. **A parent must appear earlier in
`nodes[]` than any of its children.**

```bash
mkdir -p .claude
# write .claude/devops-tools.json
```

### 6. Lay it out and validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/layout-board.mjs" .claude/devops-tools.json
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-board.mjs" .claude/devops-tools.json
```

The layout script computes every position and size from the graph. The validator enforces exactly
what the desktop app enforces, so a board that passes here opens there.

**If the validator fails, fix the JSON and run both again.** Do not hand the user a board the app
will refuse — you have the Terraform in context now and they will not.

### 7. Check it will actually be committed

```bash
git check-ignore -v .claude/devops-tools.json
```

Output means the file is gitignored, and a board that is not committed cannot version alongside the
Terraform. Tell the user, and suggest either removing the pattern or adding
`!.claude/devops-tools.json` — do not edit `.gitignore` yourself without asking.

### 8. Report

State plainly:

- what you mapped: `N containers, N resources, N edges` and the region.
- **what you folded**, grouped by reason — the user needs to see the judgement calls to disagree
  with them. Name anything ambiguous.
- any assumption you made (an undeterminable subnet tier, an unknowable `for_each` count).
- that the file is written, and they can open the project in DevOps Tools. If the app is already
  open on this project, the canvas updates on its own.
