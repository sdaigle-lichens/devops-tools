// Board model → React Flow's node and edge arrays.
//
// Pure, and deliberately node-testable: the interesting behaviour here is the read-only posture
// and the parent/child bookkeeping, and neither needs a browser to check. `@xyflow/react` is
// imported for TYPES ONLY, so nothing from it survives to runtime and this module stays safe to
// run under vitest's node environment.

import type { Edge, Node } from "@xyflow/react";
import type { Board, BoardEdge, BoardNode } from "./board-schema.js";

/** What a node component receives on `data`. */
export interface FlowNodeData extends Record<string, unknown> {
  node: BoardNode;
}

export type BoardFlowNode = Node<FlowNodeData>;

/**
 * How many summary lines a resource node draws.
 *
 * Shared with `plugins/devops-tools/scripts/layout-board.mjs`, which adds a row of height per
 * summary line up to this same limit. If the two disagree, nodes either clip their last row or
 * leave a gap — and neither shows up anywhere except on screen.
 */
export const MAX_SUMMARY_ROWS = 3;

/**
 * Read-only is enforced here rather than only on the `<ReactFlow>` element, because the
 * element-level props are easy to lose in a refactor and a per-node `draggable: false` is not.
 * The app has no way to persist a moved node, so a node that could be moved would just lie.
 */
export function boardToFlowNodes(board: Board): BoardFlowNode[] {
  return board.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    data: { node },
    ...(node.parentId
      ? { parentId: node.parentId, extent: "parent" as const }
      : {}),
    ...(node.size ? { width: node.size.width, height: node.size.height } : {}),
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: true,
    // Containers are drawn behind their children. Without this a subnet box painted after the
    // resources inside it swallows their clicks.
    ...(node.kind === "container" ? { zIndex: 0 } : { zIndex: 1 }),
  }));
}

/**
 * `stroke` is set explicitly rather than left to React Flow's default.
 *
 * Its default edge colour is tuned for its own canvas background, and against this app's darker
 * one the lines came out barely visible — a diagram whose connections you have to hunt for. The
 * values are theme tokens, so they follow light and dark without a second table.
 */
const EDGE_STYLES: Record<
  BoardEdge["kind"],
  { dashed: boolean; animated: boolean; stroke: string }
> = {
  route: { dashed: false, animated: false, stroke: "var(--ink-3)" },
  traffic: { dashed: false, animated: true, stroke: "var(--accent)" },
  reference: { dashed: true, animated: false, stroke: "var(--line-strong)" },
  association: { dashed: true, animated: false, stroke: "var(--line-strong)" },
};

export function boardToFlowEdges(board: Board): Edge[] {
  return board.edges.map((edge) => {
    const style = EDGE_STYLES[edge.kind];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      // Orthogonal, not the default bezier. On a nested diagram a bezier between two boxes on
      // opposite sides of a VPC sweeps a curve across everything in between; a stepped line reads
      // as a connection rather than as noise, which is how infrastructure diagrams are drawn.
      type: "smoothstep",
      label: edge.label,
      animated: style.animated,
      deletable: false,
      reconnectable: false,
      data: { kind: edge.kind, notes: edge.notes },
      style: {
        stroke: style.stroke,
        strokeWidth: 1.5,
        ...(style.dashed ? { strokeDasharray: "4 4" } : {}),
      },
      // A label sitting directly on the canvas lands on top of whatever the edge passes over and
      // becomes unreadable. Give it the surface colour to sit on.
      labelStyle: { fill: "var(--ink-2)", fontSize: 10 },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.92 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
    };
  });
}

/**
 * Depth of a node in the container tree, for indenting the outline and for the detail panel's
 * breadcrumb. Returns 0 for a top-level node.
 */
export function containerPath(board: Board, id: string): BoardNode[] {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const path: BoardNode[] = [];
  let current = byId.get(id)?.parentId ?? null;
  // The schema forbids cycles by requiring parents to appear first, but this walk runs on data
  // that reached us from disk — bound it rather than trust that.
  while (current && path.length < board.nodes.length) {
    const parent = byId.get(current);
    if (!parent) break;
    path.unshift(parent);
    current = parent.parentId ?? null;
  }
  return path;
}
