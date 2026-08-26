// The `.claude/devops-tools.json` contract.
//
// This file is the single source of truth for the format. The app validates against it on load,
// and `plugins/devops-tools/scripts/lib/board-schema.cjs` — the bundle the init/update skills run
// their validator from — is GENERATED from this file by scripts/build-plugin-libs.mjs. If the two
// ever disagree, a skill writes a board the app then refuses, so they are not allowed to.
//
// Everything here describes a board that has ALREADY been laid out. The skill owns positions; the
// app never computes one and never writes one back.

import { z } from "zod";

/** Current format version. Bump only for a breaking change, and teach the loader to migrate. */
export const SCHEMA_VERSION = 1;

/**
 * A JSON value, recursively. Terraform attributes are arbitrarily shaped — a `tags` map, a
 * `lifecycle_rule` list of objects, a bare string — and the detail panel renders whatever it is
 * given as a tree. Constraining the shape here would only push the skill into flattening data the
 * user wants to read.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * `container` draws a labelled box others sit inside (VPC, availability zone, subnet).
 * `resource` is a leaf AWS resource.
 * `external` is something outside the account the Terraform manages — the internet, a Cloudflare
 * edge, an on-prem network — drawn differently so nobody reads it as infrastructure they own.
 */
export const nodeKindSchema = z.enum(["container", "resource", "external"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

/**
 * What a container represents. Drives the border colour and the header label, and nothing else —
 * the layout is already baked into `position`/`size` by the time the app sees it.
 */
export const containerRoleSchema = z.enum([
  "region",
  "vpc",
  "availability_zone",
  "public_subnet",
  "private_subnet",
  "group",
]);
export type ContainerRole = z.infer<typeof containerRoleSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const sourceRefSchema = z.object({
  /** Repo-relative, forward slashes. `infra/network.tf`, never an absolute path. */
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});

export const boardNodeSchema = z.object({
  /**
   * Stable identity, and the reason `update-devops-tools` can preserve a layout across a
   * Terraform change. Use the Terraform address including any for_each/count key —
   * `aws_subnet.this["public-a"]` — so a node keeps its id as long as the resource exists.
   */
  id: z.string().min(1),
  kind: nodeKindSchema,
  /** Only meaningful when `kind` is "container". */
  role: containerRoleSchema.optional(),
  /** Terraform resource type, e.g. `aws_vpc`. Absent for synthetic containers like an AZ box. */
  resourceType: z.string().optional(),
  /**
   * Stable service slug (`vpc`, `s3`, `ec2`), keyed off the resource type rather than a display
   * name. Nothing reads it in v1; it is the hook an icon map hangs off later without needing
   * every board in the world to be regenerated.
   */
  service: z.string().optional(),
  label: z.string().min(1),
  /** Container id this node sits inside, or null/absent for a top-level node. */
  parentId: z.string().nullable().optional(),
  /** RELATIVE to `parentId` when nested, absolute when top-level. React Flow's convention. */
  position: positionSchema,
  /** Required for containers — a box with no size has nothing to draw. Optional for leaves. */
  size: sizeSchema.optional(),
  /** Attribute keys worth showing on the node face itself. Must exist in `attributes`. */
  summary: z.array(z.string()).optional(),
  attributes: z.record(z.string(), jsonValueSchema).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  source: sourceRefSchema.optional(),
  /** Free prose from the skill — the "why" a diagram cannot carry. Rendered in the panel. */
  notes: z.string().optional(),
});
export type BoardNode = z.infer<typeof boardNodeSchema>;

export const edgeKindSchema = z.enum([
  "route",
  "reference",
  "traffic",
  "association",
]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;

export const boardEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: edgeKindSchema,
  label: z.string().optional(),
  notes: z.string().optional(),
});
export type BoardEdge = z.infer<typeof boardEdgeSchema>;

/**
 * The audit trail, and the thing that makes a condensed diagram trustworthy.
 *
 * Real Terraform is mostly attachment resources — `aws_s3_bucket_versioning`,
 * `aws_vpc_security_group_ingress_rule`, `aws_route_table_association`. Drawing each as a box
 * produces a hairball; dropping them silently produces a diagram nobody can check. So every
 * resource that did not become a node has to say where it went.
 */
export const foldedResourceSchema = z.object({
  address: z.string().min(1),
  /** Node id that absorbed it, or null when it was dropped outright. */
  into: z.string().nullable(),
  reason: z.string().min(1),
});
export type FoldedResource = z.infer<typeof foldedResourceSchema>;

const boardShape = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** ISO 8601. Informational — nothing keys off it. */
  generatedAt: z.iso.datetime().optional(),
  generatedBy: z.string().optional(),
  project: z.object({
    name: z.string().min(1),
    /** Repo-relative directory the `.tf` files were read from, e.g. `infra`. */
    terraformRoot: z.string().min(1),
    /**
     * Which real, independently-deployed environment this board describes — a separate root
     * module (`prod`, `staging`) or a `-var-file` selection against a shared root
     * (`bxl-dev`, `transfert-prod`). Only meaningful when a project has more than one board, laid
     * out as `.claude/devops-tools/<id>.json`; the loader uses the filename as the id and this
     * field as the human label. Absent for the common single-board project.
     */
    environment: z.string().min(1).optional(),
  }),
  provider: z
    .object({
      region: z.string().optional(),
      profile: z.string().optional(),
    })
    .optional(),
  nodes: z.array(boardNodeSchema),
  edges: z.array(boardEdgeSchema),
  folded: z.array(foldedResourceSchema).optional(),
});

/**
 * The invariants a per-field schema cannot express. Every one of these is a real failure mode
 * that renders as a blank or scrambled canvas rather than an error, which is why they are checked
 * up front instead of being left to React Flow.
 */
export const boardSchema = boardShape.superRefine((board, ctx) => {
  const seen = new Set<string>();
  const containers = new Set<string>();

  board.nodes.forEach((node, i) => {
    if (seen.has(node.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", i, "id"],
        message: `duplicate node id "${node.id}"`,
      });
    }
    seen.add(node.id);
    if (node.kind === "container") containers.add(node.id);

    // React Flow reads the array in order and looks the parent up as it goes: a child that
    // appears before its parent is dropped from the render with no error at all.
    if (node.parentId) {
      if (!seen.has(node.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i, "parentId"],
          message: `parent "${node.parentId}" must appear earlier in nodes[] than its child "${node.id}" (React Flow silently drops children that come first)`,
        });
      } else if (!containers.has(node.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i, "parentId"],
          message: `parent "${node.parentId}" is not a container node`,
        });
      }
    }

    if (node.kind === "container" && !node.size) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", i, "size"],
        message: `container "${node.id}" needs a size`,
      });
    }

    for (const key of node.summary ?? []) {
      if (!node.attributes || !(key in node.attributes)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i, "summary"],
          message: `summary key "${key}" is not present in attributes`,
        });
      }
    }
  });

  const edgeIds = new Set<string>();
  board.edges.forEach((edge, i) => {
    if (edgeIds.has(edge.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", i, "id"],
        message: `duplicate edge id "${edge.id}"`,
      });
    }
    edgeIds.add(edge.id);
    for (const end of ["source", "target"] as const) {
      if (!seen.has(edge[end])) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, end],
          message: `edge ${end} "${edge[end]}" is not a node id`,
        });
      }
    }
  });

  board.folded?.forEach((folded, i) => {
    if (folded.into !== null && !seen.has(folded.into)) {
      ctx.addIssue({
        code: "custom",
        path: ["folded", i, "into"],
        message: `folded into "${folded.into}", which is not a node id`,
      });
    }
  });
});

export type Board = z.infer<typeof boardShape>;

/** Human-readable `path: message` lines, one per issue — what both the app and the CLI print. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

export type ParseBoardResult =
  { ok: true; board: Board } | { ok: false; errors: string[] };

/** Validate an already-parsed JSON value. The only entry point anything else should use. */
export function parseBoard(data: unknown): ParseBoardResult {
  const result = boardSchema.safeParse(data);
  return result.success
    ? { ok: true, board: result.data }
    : { ok: false, errors: formatIssues(result.error) };
}
