import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBoard, type Board } from "../src/core/board-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(
    fs.readFileSync(path.join(here, "fixtures", "oli-board.json"), "utf8"),
  ) as Board;

/** The fixture, with one mutation applied — so each case states only what it is breaking. */
function broken(mutate: (board: Board) => void): unknown {
  const board = fixture();
  mutate(board);
  return board;
}

describe("parseBoard", () => {
  it("accepts a real board", () => {
    const result = parseBoard(fixture());
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown schema version rather than guessing", () => {
    const result = parseBoard(
      broken((b) => ((b as { schemaVersion: number }).schemaVersion = 99)),
    );
    expect(result.ok).toBe(false);
  });

  // The failure this exists for is silent: React Flow walks the array in order and drops a child
  // whose parent it has not seen yet, so the canvas comes up missing nodes with nothing in the
  // console. Far better to refuse the file.
  it("rejects a child that appears before its parent", () => {
    const result = parseBoard(
      broken((b) => {
        const childIndex = b.nodes.findIndex((n) => n.id === "az.a");
        const parentIndex = b.nodes.findIndex((n) => n.id === "aws_vpc.main");
        const [child] = b.nodes.splice(childIndex, 1);
        b.nodes.splice(parentIndex, 0, child);
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("must appear earlier");
  });

  it("rejects a parentId that names no node", () => {
    const result = parseBoard(
      broken((b) => (b.nodes[b.nodes.length - 1].parentId = "aws_vpc.ghost")),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a parentId that names a leaf rather than a container", () => {
    const result = parseBoard(
      broken((b) => {
        const igw = b.nodes.find((n) => n.id === "aws_internet_gateway.main")!;
        b.nodes.find((n) => n.id === "aws_security_group.web")!.parentId =
          igw.id;
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("not a container");
  });

  it("rejects an edge pointing at a node that does not exist", () => {
    const result = parseBoard(
      broken((b) => (b.edges[0].target = "aws_instance.nope")),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("is not a node id");
  });

  it("rejects duplicate node ids", () => {
    const result = parseBoard(broken((b) => b.nodes.push({ ...b.nodes[0] })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("duplicate node id");
  });

  it("rejects a container with no size, which would draw nothing", () => {
    const result = parseBoard(
      broken((b) => delete b.nodes.find((n) => n.id === "az.a")!.size),
    );
    expect(result.ok).toBe(false);
  });

  // A summary key naming an attribute that isn't there renders as a blank row on the node face —
  // it looks like the value is empty rather than like the board is wrong.
  it("rejects a summary key with no matching attribute", () => {
    const result = parseBoard(
      broken(
        (b) =>
          (b.nodes.find((n) => n.id === "aws_s3_bucket.images")!.summary = [
            "not_a_key",
          ]),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("not present in attributes");
  });

  it("rejects a folded entry pointing at a node that does not exist", () => {
    const result = parseBoard(
      broken((b) => (b.folded![0].into = "aws_s3_bucket.ghost")),
    );
    expect(result.ok).toBe(false);
  });

  it("allows a folded entry with into: null, for a resource that became an edge", () => {
    const result = parseBoard(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.board.folded!.some((f) => f.into === null)).toBe(true);
  });

  it("reports every problem at once, so one round trip fixes the file", () => {
    const result = parseBoard(
      broken((b) => {
        b.edges[0].target = "nope";
        b.edges[1].source = "also-nope";
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
