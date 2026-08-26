# TODO

Next steps for DevOps Tools, roughly in the order I would do them. Everything here is grounded in
something observed while building the thing — a measurement, a screenshot, or a gap the code
comments already admit to. Where a claim was verified, the evidence is named.

---

## 1. Bugs

### The first board a project ever gets does not reach an open window — **measured**

The empty state says, in `board-placeholders.tsx`:

> The canvas picks it up as soon as the file lands — no need to reopen the project.

That is false for exactly the case the screen is shown in. `board-watcher.ts` watches the
`.claude/` **directory**, and when the directory does not exist yet `fs.watch` throws and the
watcher is set to `null` — no watch, no retry. A project with no `.claude/` is precisely a project
that has never run the init skill, so the promise breaks on the primary onboarding path: open an
unmapped project, run `/devops-tools:init-devops-tools`, watch nothing happen.

Verified with a probe against the packaged build: open a project with `infra/main.tf` and no
`.claude/`, wait for "No board yet", then `mkdir .claude` and write the board. The canvas never
appeared within 8s. The existing live-reload check in `probe.mjs` passes only because its `mapped`
fixture already has a `.claude/` directory.

Fix: watch the project root for the creation of `.claude/`, then hand off to the existing
directory watch — or watch the root recursively and filter. Whatever the approach, it needs a
probe case built on a project with **no** `.claude/`, since that is the hole the current suite has.

### Edge labels collide with nodes

Visible in the canvas screenshots: the `0.0.0.0/0, ::/0` label on the route-table → IGW edge
renders half-behind the route table node and reads as `0.0/0`. `labelBgStyle` is set in
`board-to-flow.ts` but does not lift the label clear of node geometry, because React Flow places it
at the path midpoint regardless of what is there.

---

## 2. Highest value next

### Run the skills against real Terraform, end to end

**The single biggest untested surface.** `test/fixtures/oli-board.json` was written by hand from
reading `~/gits/oli/infra`, not produced by `init-devops-tools`. So the schema, the layout script,
the validator and the app are all exercised — and the skill that is supposed to generate the input
to all of them never has been.

Run `/devops-tools:init-devops-tools` in a real AWS Terraform repo and check:

- does it fold the attachment resources, or does it draw thirty boxes?
- is every skipped resource in `folded[]`?
- does it get subnet tier right by tracing routes, rather than guessing from a tag?
- does `update-devops-tools` produce an empty diff when nothing changed?

That last one is the property the whole design rests on and it has only been verified for
`layout-board.mjs` in isolation.

Then consider `claude plugin eval` — the CLI ships an eval runner (`claude plugin eval`,
`evals/**/case.yaml`), which is the right way to keep skill quality from drifting, given the output
is model-generated and a unit test cannot check it.

### Surface `folded[]` in the UI

The README's central claim is that a condensed diagram is trustworthy _because_ every folded
resource is recorded and checkable. The schema enforces it, the validator counts it — and the app
never shows it. Today the only way to check the model's judgement is to read the JSON.

A panel listing folded resources grouped by reason, with the node each went into, makes the
promise real. Probably the cheapest large gain in the list.

### Let the user quiet the edges

The screenshots show the honest problem with a real architecture: two route tables joined to four
subnets across two AZs is a lot of crossing lines, and `association` edges are the bulk of it while
carrying the least information. Smoothstep routing helped; it did not solve it.

A legend that toggles edge `kind` on and off (`route` / `traffic` / `reference` / `association`)
would fix most of it for almost no code — the kinds are already in `edge.data`. Collapsible
containers would fix the rest, and are the standard answer for architectures larger than the
fixture.

---

## 3. Deferred from v1 — the decisions are already made

### AWS service icons

`service` is already in the schema as the hook, so this is additive and needs no board
regeneration. The licensing was researched and the conclusion is:

- Bundle the **official AWS Architecture Icons** SVG package **unmodified**, pin the release
  (`07312026`), and add a `THIRD-PARTY-NOTICES` crediting Amazon Web Services. AWS's own
  `awslabs/aws-icons-for-plantuml` licenses the same artwork **CC-BY-ND 2.0**, under which verbatim
  redistribution in a collective work is fine but recolouring or re-tracing is not.
- **Avoid the `aws-react-icons` npm package** despite far better DX: it blanket-claims MIT over
  AWS-owned artwork with no attribution, which a third party cannot grant.
- Do not use the icons for non-AWS services, and do not imply AWS endorsement.

Note the folder naming in the zip changes between quarterly releases, so pin it and write the
filename → `service` mapping ourselves.

### Search / filter and a minimap

Both scale-driven. The 18-node fixture does not need them; a real production account will.

---

## 4. Robustness

- **Multi-environment.** One board per repo, at a hardcoded path. A repo with `infra/prod` and
  `infra/staging` cannot have two, and the init skill currently asks the user to pick one. Needs a
  board-per-root story before it meets a real monorepo.
- **`schemaVersion` has no migration path.** It is `z.literal(1)`, so a v2 board is simply refused.
  Fine today, since the only boards in the world are ours — but the migration story has to exist
  before the first breaking change, or every committed board in every repo breaks at once.
- **`looksLikeTerraformProject` stops at depth 3.** A monorepo with `packages/infra/aws/…` gets a
  false "no Terraform found" badge on the home screen. It is only a label, not a gate, but it is
  wrong.
- **Nothing renders edge `notes`.** They are carried through `boardToFlowEdges` into `edge.data`
  and never surfaced; clicking an edge does nothing. The detail panel handles nodes only.
- **No board-level view.** `project`, `provider.region` and the node/edge/folded counts exist in
  the file; the header shows the project name and path and nothing else.

---

## 5. Shipping

- **No installer.** There is no `electron-builder` config, so the app runs from source only. Needs
  an asar/unpack review and a signing story before it can be handed to anyone who will not run
  `pnpm install`.
- **No CI.** `just verify` and `just probe` are run by hand. `verify` would drop straight into a
  GitHub Actions job; `probe` needs `xvfb` and the `chrome-sandbox` setuid step, which is awkward
  in a container — worth deciding whether it runs in CI at all, or stays a local gate.
- **Plugin release process.** `claude plugin tag` creates a `{name}--v{version}` tag and validates
  that `plugin.json` and the marketplace entry agree. Worth adopting before anyone else installs
  from this marketplace, so versions mean something.

---

## 6. Further out

- **Diff two boards.** The file is committed and versioned, so `git show HEAD~1:.claude/devops-tools.json`
  against the working copy is a rendered architecture diff — arguably the most valuable thing a
  versioned diagram can do, and the reason for committing it in the first place.
- **Cost annotation.** The `oli` Terraform's comments are largely about what each resource costs
  and why the expensive option was avoided. That reasoning currently lands in `notes` as prose.
- **A second plugin.** The repo is named `devops-tools` and the marketplace publishes one plugin.
  The name leaves room; nothing about the structure has to change to add another.
