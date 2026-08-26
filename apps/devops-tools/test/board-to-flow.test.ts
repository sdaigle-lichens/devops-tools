import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  boardToFlowEdges,
  boardToFlowNodes,
  containerPath,
} from "../src/core/board-to-flow.js";
import { parseBoard, type Board } from "../src/core/board-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const parsed = parseBoard(
  JSON.parse(
    fs.readFileSync(path.join(here, "fixtures", "oli-board.json"), "utf8"),
  ),
);
if (!parsed.ok)
  throw new Error(`fixture does not validate:\n${parsed.errors.join("\n")}`);
const board: Board = parsed.board;

describe("boardToFlowNodes", () => {
  it("carries every node across", () => {
    expect(boardToFlowNodes(board)).toHaveLength(board.nodes.length);
  });

  // The read-only promise, in the one place a refactor is most likely to quietly drop it. The
  // <ReactFlow> element sets these too; a node that could be dragged would be lying, because the
  // app has nowhere to persist the move to.
  it("makes every node undraggable, unconnectable and undeletable", () => {
    for (const node of boardToFlowNodes(board)) {
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(false);
      expect(node.deletable).toBe(false);
    }
  });

  it("nests children with extent: parent so they cannot escape their container", () => {
    const flow = boardToFlowNodes(board);
    const subnet = flow.find((n) => n.id === 'aws_subnet.this["public-a"]')!;
    expect(subnet.parentId).toBe("az.a");
    expect(subnet.extent).toBe("parent");
  });

  it("leaves parentId off a top-level node rather than setting it to null", () => {
    const vpc = boardToFlowNodes(board).find((n) => n.id === "aws_vpc.main")!;
    expect(vpc.parentId).toBeUndefined();
  });

  it("maps kind to the node type the canvas registers", () => {
    const byId = new Map(boardToFlowNodes(board).map((n) => [n.id, n]));
    expect(byId.get("aws_vpc.main")!.type).toBe("container");
    expect(byId.get("aws_security_group.web")!.type).toBe("resource");
    expect(byId.get("external.internet")!.type).toBe("external");
  });

  // Every node, leaf included, renders at exactly the size the layout script wrote down. Letting a
  // leaf size itself was the original design and it produced overlapping nodes on the canvas: the
  // layout places siblings on a grid using the size it assumed, so a node that grew to fit a long
  // label sat on its neighbour while the board JSON still validated. Measured at 204px against an
  // assumed 180.
  it("gives every node an explicit size, so the DOM cannot disagree with the layout", () => {
    for (const node of boardToFlowNodes(board)) {
      expect(node.width, `${node.id} has no width`).toBeGreaterThan(0);
      expect(node.height, `${node.id} has no height`).toBeGreaterThan(0);
    }
  });

  it("passes the board's declared size through unchanged", () => {
    const byId = new Map(boardToFlowNodes(board).map((n) => [n.id, n]));
    for (const node of board.nodes) {
      expect(byId.get(node.id)!.width).toBe(node.size!.width);
      expect(byId.get(node.id)!.height).toBe(node.size!.height);
    }
  });

  // A container is painted over the whole area its children occupy. Same z-index, and it
  // swallows every click meant for a resource inside it.
  it("puts containers behind their children", () => {
    const byId = new Map(boardToFlowNodes(board).map((n) => [n.id, n]));
    expect(byId.get("aws_vpc.main")!.zIndex).toBeLessThan(
      byId.get("aws_security_group.web")!.zIndex!,
    );
  });
});

describe("boardToFlowEdges", () => {
  it("carries every edge across, undeletable", () => {
    const edges = boardToFlowEdges(board);
    expect(edges).toHaveLength(board.edges.length);
    for (const edge of edges) expect(edge.deletable).toBe(false);
  });

  it("dashes reference and association edges, and animates traffic", () => {
    const byId = new Map(boardToFlowEdges(board).map((e) => [e.id, e]));
    expect(byId.get("e.sg.pl4")!.style?.strokeDasharray).toBe("4 4");
    expect(byId.get("e.public-a.rt")!.style?.strokeDasharray).toBe("4 4");
    expect(byId.get("e.cf.sg")!.animated).toBe(true);
    expect(byId.get("e.rt-public.igw")!.style?.strokeDasharray).toBeUndefined();
  });
});

describe("containerPath", () => {
  it("walks from the outermost container inwards", () => {
    expect(
      containerPath(board, 'aws_subnet.this["public-a"]').map((n) => n.id),
    ).toEqual(["aws_vpc.main", "az.a"]);
  });

  it("is empty for a top-level node", () => {
    expect(containerPath(board, "aws_s3_bucket.images")).toEqual([]);
  });

  // The schema forbids cycles, but this walk runs on data that came off a user's disk.
  it("terminates on a cycle rather than hanging the renderer", () => {
    const cyclic: Board = JSON.parse(JSON.stringify(board));
    cyclic.nodes.find((n) => n.id === "aws_vpc.main")!.parentId = "az.a";
    expect(() =>
      containerPath(cyclic, 'aws_subnet.this["public-a"]'),
    ).not.toThrow();
  });
});
