# `.claude/devops-tools.json`

The file both skills write and the DevOps Tools desktop app reads. It lives in the project being
mapped, and it is **meant to be committed** — the point is that the diagram versions alongside the
Terraform that produced it, so a reviewer can see the architecture change in the same pull request
as the infrastructure change.

The authoritative definition is `apps/devops-tools/src/core/board-schema.ts` in the devops-tools
repo. `scripts/lib/board-schema.cjs` is generated from it, and `scripts/validate-board.mjs` checks
a file against it. **Always run the validator after writing.** This document is the readable half;
where the two disagree, the schema wins.

## Shape

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-26T12:00:00Z",     // ISO 8601, optional
  "generatedBy": "devops-tools:init-devops-tools",
  "project": { "name": "oli", "terraformRoot": "infra" },
  "provider": { "region": "ca-central-1" },  // optional
  "nodes": [ /* see below */ ],
  "edges": [ /* see below */ ],
  "folded": [ /* see below */ ]
}
```

## Where the file lives

Most projects have one architecture and one file: `.claude/devops-tools.json`.

A project with **more than one real, independently-deployed environment** — a separate root
module (`infra/prod`, `infra/staging`), or one root module applied with different `-var-file`s
that enable different resources — gets one complete board per environment instead, at
`.claude/devops-tools/<id>.json`. `<id>` is whatever name distinguishes the environments (the
tfvars filename minus its extension, or the root module's directory name); it becomes the id the
app's environment picker uses, and `project.environment` (below) becomes its label.

**Never merge environments into one board.** A board is supposed to describe one real, deployable
architecture. A file that draws every resource any environment might enable — Qdrant *and* Mongo
*and* a module some environments never turn on — describes a deployment that has never actually
existed. See [Multiple environments](#multiple-environments) below for how to tell the two layouts
apart and which one to write.

### `project`

| field | required | notes |
|---|---|---|
| `name` | ✅ | |
| `terraformRoot` | ✅ | Repo-relative directory the `.tf` files were read from. |
| `environment` | | Set only when the project has more than one board (see above). The human label for this one — `bxl-dev`, `transfert-prod`, `prod`. Omit for the common single-board project. |

### `nodes[]`

| field | required | notes |
|---|---|---|
| `id` | ✅ | The Terraform address, **including the `for_each`/`count` key**: `aws_subnet.this["public-a"]`. Synthetic containers use a short slug: `az.a`. |
| `kind` | ✅ | `container` \| `resource` \| `external` |
| `role` | containers | `region` \| `vpc` \| `availability_zone` \| `public_subnet` \| `private_subnet` \| `group`. Drives the border colour and header. |
| `label` | ✅ | What a human calls it. Prefer the `Name` tag over the Terraform local name. |
| `resourceType` | | `aws_vpc`, `aws_s3_bucket`. Omit for synthetic containers. |
| `service` | | Stable slug — `vpc`, `s3`, `ec2`. Nothing reads it yet; it is the hook icons hang off later. |
| `parentId` | | The container this sits inside. Omit for top level. |
| `position` | ✅ | Written by `layout-board.mjs`. Emit `{"x":0,"y":0}` and let the script fill it in. |
| `size` | containers | Same — the layout script computes it. |
| `attributes` | | Free-form JSON. The specs the side panel shows. |
| `summary` | | Attribute keys to show on the node face itself. Every key **must** exist in `attributes`. Keep to 1–3. |
| `tags` | | Terraform `tags`, flat string→string. |
| `source` | | `{ "file": "infra/network.tf", "line": 49 }` — repo-relative, forward slashes. |
| `notes` | | Prose a diagram cannot carry. Load-bearing comments in the `.tf` belong here. |

**A parent must appear earlier in `nodes[]` than its children.** React Flow walks the array in
order and silently drops a child it sees before its parent, so the schema refuses the file rather
than let the app render a diagram that is quietly missing boxes.

### `edges[]`

```jsonc
{ "id": "e.rt-public.igw", "source": "aws_route_table.public",
  "target": "aws_internet_gateway.main", "kind": "route", "label": "0.0.0.0/0" }
```

`kind` is one of:

- `route` — a routing decision. A route table to a gateway or an endpoint.
- `traffic` — data actually flows this way. Drawn animated.
- `reference` — one resource names another (a security group referencing a prefix list).
- `association` — an attachment (a subnet to a route table).

Both endpoints must be node ids.

### `folded[]`

```jsonc
{ "address": "aws_s3_bucket_versioning.images", "into": "aws_s3_bucket.images",
  "reason": "configuration of the parent bucket" }
```

Every Terraform resource that did **not** become a node needs an entry. `into` is the node that
absorbed it, or `null` when it became an edge or was dropped outright.

This is not bookkeeping for its own sake. A condensed diagram is only trustworthy if the reader can
check that nothing vanished silently — and the skill is making judgement calls the user may
disagree with.

## What becomes a node, and what does not

Real Terraform is mostly attachment and configuration resources. Drawing each as a box produces a
hairball nobody reads; dropping them silently produces a diagram nobody can trust. So:

**Becomes a node** — anything a person would point at on a whiteboard: VPC, subnet, EC2 instance,
RDS instance, S3 bucket, Lambda function, ALB, CloudFront distribution, API Gateway, ECS
service/cluster, SQS queue, SNS topic, DynamoDB table, NAT gateway, internet gateway, route table,
VPC endpoint, security group, managed prefix list, EFS file system, ElastiCache cluster.

**Folds into its parent's `attributes`** — configuration of a single resource:

| pattern | folds into |
|---|---|
| `aws_s3_bucket_versioning`, `_public_access_block`, `_lifecycle_configuration`, `_server_side_encryption_configuration`, `_policy`, `_cors_configuration`, `_notification` | the `aws_s3_bucket` |
| `aws_vpc_security_group_ingress_rule`, `_egress_rule`, `aws_security_group_rule` | the `aws_security_group` |
| `aws_lb_listener`, `aws_lb_listener_rule` | the `aws_lb` |
| `aws_iam_role_policy`, `aws_iam_role_policy_attachment` | the `aws_iam_role` |
| `aws_db_parameter_group`, `aws_db_subnet_group` | the `aws_db_instance` |
| `aws_cloudwatch_log_group` for one function | that function |

**Becomes an edge** rather than a node:

| pattern | edge |
|---|---|
| `aws_route` | route table → gateway/endpoint, `kind: "route"`, `label` = the destination CIDR |
| `aws_route_table_association` | subnet → route table, `kind: "association"` |
| `aws_network_interface_attachment`, `aws_volume_attachment` | `kind: "association"` |
| `aws_lambda_event_source_mapping` | source → function, `kind: "traffic"` |

**Never a node, always `folded` with `into: null` or a note:**

- `data` sources — they describe the world, they are not infrastructure. Fold a data source into
  the node it informs (`data.aws_availability_zones` → the VPC) or into an `external` node when it
  describes something outside the account (`data.cloudflare_ip_ranges` → an `external` Cloudflare
  node), and give the reason.
- `locals`, `variable`, `output`, `terraform`/`provider` blocks.
- `random_*`, `null_resource`, `time_*`, `tls_*`.

**Non-AWS providers are out of scope.** This app is AWS-only. A `cloudflare_*` or `datadog_*`
resource is either an `external` node (when traffic reaches AWS through it) or a `folded` entry —
never a `resource` node.

## `for_each` and `count`

One HCL block often means several real resources. Emit one node per instance, with the key in the
id and the label:

```
resource "aws_subnet" "this" { for_each = local.subnets }   # 4 entries
  → aws_subnet.this["public-a"], aws_subnet.this["private-a"],
    aws_subnet.this["public-b"], aws_subnet.this["private-b"]
```

When the count is not statically knowable (`for_each` over a data source, `count = var.n`), emit
one node, label it with the multiplicity (`api ×N`), and say why in `notes`.

## Values stay symbolic

Nothing here runs `terraform`, so `var.vpc_cidr` cannot be resolved to `10.0.0.0/16` — and
guessing is worse than not knowing. Write the reference through as-is (`"${var.vpc_cidr}"`,
`"cidrsubnet(vpc, 8, 0)"`). If a `variable` block has a `default`, it is fine to add it as a
separate attribute (`"cidr_block_default": "10.0.0.0/16"`), clearly labelled.

**Never read `terraform.tfstate`, `*.tfvars`, or `.env`.** State files contain resolved secrets,
and this file gets committed. This rule has no exception for a value that looks harmless — a
boolean feature flag lives in the same file as a database password, and a partial read is much
harder to audit than an absolute one.

## Multiple environments

A project has more than one real environment in either of two shapes:

- **Separate root modules.** `infra/prod` and `infra/staging` (or similar) are independent
  Terraform configurations. Each gets its own board, mapped independently.
- **One root, several `-var-file`s.** A single root module applied with `terraform/env/*.tfvars`
  or equivalent, where the tfvars files select different resources into existence — a
  `count = var.qdrant_enable ? 1 : 0` that is on in one environment and off in another. The
  filenames alone are not read-only-safe to infer values from; the environments exist and their
  *names* are visible from the filenames, but what each one turns on or off is not, since that
  lives inside the file this skill never opens.

**Detecting which shape applies:**

- More than one directory that independently looks like a Terraform root (its own provider
  configuration, not just a module called by another root) → separate roots.
  Ask which environment to map (`init`) or work out which board file corresponds to which (`update`).
- A single root plus a directory of `*.tfvars` files (`terraform/env/`, `environments/`, or
  similar) → shared root, `-var-file` environments. Read the **filenames** to learn the
  environment names — that is not a "resolved secret," it is a directory listing. Do not open the
  files.

**Building a board per shared-root environment without reading tfvars:** find every place a
resource's existence or count depends on a variable (`count = var.x_enable ? 1 : 0`,
`for_each = var.y_enable ? {...} : {}`) by reading the `.tf` source, not the tfvars. Then **ask the
user** which environments enable which of those flags, rather than inferring it — a direct
question keeps the "never open a tfvars file" rule absolute instead of turning it into "except for
these lines," which is much harder for someone auditing this skill's behaviour later to trust.
Build one graph per environment from the answers, and write each to its own
`.claude/devops-tools/<id>.json`.

If a project is migrating from a single `.claude/devops-tools.json` to this layout because a
second environment just appeared, say so explicitly and ask before removing the old single file —
leaving both around means the app has two disagreeing sources for the same project.

## Containers to build

Nest in this order, skipping any level the project does not have:

```
region (only when the project spans more than one)
└── vpc
    └── availability_zone      ← synthetic; id "az.a", "az.b"
        └── public_subnet / private_subnet
            └── resources
```

A subnet's role comes from how it routes, not from its name: a subnet whose route table has a
`0.0.0.0/0` route to an internet gateway is `public_subnet`, otherwise `private_subnet`. If the
Terraform makes that undeterminable, fall back to `map_public_ip_on_launch` or the `Tier` tag and
note the assumption.

Resources that are not in a subnet (route tables, internet gateways, VPC endpoints, security
groups) sit directly in the VPC container. Global services (S3, CloudFront, Route 53, IAM) sit at
top level with no parent — the layout script puts them in a column on the left.

## Layout is not your job

Emit `"position": {"x": 0, "y": 0}` on every node and `"size": {"width": 220, "height": 96}` on
every container, then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/layout-board.mjs" .claude/devops-tools.json
```

It computes every position and size from the graph. Doing it that way is what makes the file
stable: the layout is a pure function of the graph, so re-running against unchanged Terraform
produces a byte-identical file and an empty `git diff`. Positioning by hand throws that away and
gets the nesting arithmetic wrong besides.

Order within a container is preserved, so the order you emit nodes in is the order they appear.
