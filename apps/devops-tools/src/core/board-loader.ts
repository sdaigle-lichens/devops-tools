// Reading `.claude/devops-tools.json` off disk.
//
// The one place in the app that touches a project's files, and it only ever reads. "Not there" is
// a first-class outcome rather than an error: a project that has never run the init skill is the
// normal case the home screen is built around, and the UI needs to tell those apart from a board
// that exists and is broken.

import fs from "node:fs";
import path from "node:path";
import { parseBoard, type Board } from "./board-schema.js";

/** Where a board lives inside a project. Relative, POSIX — joined onto the project root. */
export const BOARD_RELATIVE_PATH = path.join(".claude", "devops-tools.json");

export type BoardLoadResult =
  | { status: "ok"; board: Board; boardPath: string }
  | { status: "missing"; boardPath: string }
  | { status: "invalid"; errors: string[]; boardPath: string };

export function boardPathFor(projectRoot: string): string {
  return path.join(projectRoot, BOARD_RELATIVE_PATH);
}

export function loadBoard(projectRoot: string): BoardLoadResult {
  const boardPath = boardPathFor(projectRoot);

  let raw: string;
  try {
    raw = fs.readFileSync(boardPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "missing", boardPath };
    // EACCES, EISDIR and friends are real problems the user can act on, so they are reported as
    // an invalid board rather than quietly folded into "missing" and shown as "run the skill".
    return {
      status: "invalid",
      errors: [`could not read ${boardPath}: ${(err as Error).message}`],
      boardPath,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      status: "invalid",
      errors: [
        `${BOARD_RELATIVE_PATH} is not valid JSON: ${(err as Error).message}`,
      ],
      boardPath,
    };
  }

  const parsed = parseBoard(data);
  return parsed.ok
    ? { status: "ok", board: parsed.board, boardPath }
    : { status: "invalid", errors: parsed.errors, boardPath };
}

/**
 * Whether a directory looks like a project worth opening. Not a gate — the app opens whatever the
 * user picked — but the home screen labels a directory with no Terraform in it, because picking
 * the repo root when the `.tf` files are three levels down is the easy mistake to make.
 */
export function looksLikeTerraformProject(
  projectRoot: string,
  maxDepth = 3,
): boolean {
  const walk = (dir: string, depth: number): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".tf")) return true;
    }
    if (depth >= maxDepth) return false;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".terraform"
      )
        continue;
      if (walk(path.join(dir, entry.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(projectRoot, 0);
}
