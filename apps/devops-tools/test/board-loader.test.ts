import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_RELATIVE_PATH,
  boardPathFor,
  loadBoard,
  looksLikeTerraformProject,
} from "../src/core/board-loader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "oli-board.json");

const temps: string[] = [];

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devops-tools-test-"));
  temps.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

afterEach(() => {
  for (const root of temps.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("loadBoard", () => {
  it("loads a valid board", () => {
    const root = project({
      [BOARD_RELATIVE_PATH]: fs.readFileSync(fixturePath, "utf8"),
    });
    const result = loadBoard(root);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.board.project.name).toBe("oli");
    expect(result.boardPath).toBe(boardPathFor(root));
  });

  // The normal state of a project nobody has run the init skill on yet. It has to be
  // distinguishable from a broken board, because the UI says something completely different.
  it("reports a missing board as missing, not as an error", () => {
    const result = loadBoard(project({ "infra/main.tf": "" }));
    expect(result.status).toBe("missing");
  });

  it("reports malformed JSON as invalid, naming the file", () => {
    const root = project({ [BOARD_RELATIVE_PATH]: "{ not json" });
    const result = loadBoard(root);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors[0]).toContain("not valid JSON");
  });

  it("reports a schema violation as invalid, with the offending path", () => {
    const board = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    board.edges[0].target = "aws_instance.nope";
    const root = project({ [BOARD_RELATIVE_PATH]: JSON.stringify(board) });
    const result = loadBoard(root);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.errors.join("\n")).toContain("edges.0.target");
  });

  it("never throws on a project root that does not exist", () => {
    expect(
      loadBoard(path.join(os.tmpdir(), "devops-tools-does-not-exist")).status,
    ).toBe("missing");
  });
});

describe("looksLikeTerraformProject", () => {
  it("finds .tf files nested a few directories down", () => {
    expect(looksLikeTerraformProject(project({ "infra/network.tf": "" }))).toBe(
      true,
    );
  });

  it("is false for a repo with no Terraform", () => {
    expect(looksLikeTerraformProject(project({ "src/index.ts": "" }))).toBe(
      false,
    );
  });

  // Walking a repo's node_modules is both slow and a great way to find someone else's fixture .tf
  // and claim the project uses Terraform when it does not.
  it("does not descend into node_modules", () => {
    expect(
      looksLikeTerraformProject(
        project({ "node_modules/pkg/test/main.tf": "" }),
      ),
    ).toBe(false);
  });

  it("stops at the depth limit rather than walking a whole monorepo", () => {
    expect(
      looksLikeTerraformProject(project({ "a/b/c/d/e/main.tf": "" }), 2),
    ).toBe(false);
  });
});
