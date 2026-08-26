// Reading `.claude/devops-tools.json` off disk.
//
// The one place in the app that touches a project's files, and it only ever reads. "Not there" is
// a first-class outcome rather than an error: a project that has never run the init skill is the
// normal case the home screen is built around, and the UI needs to tell those apart from a board
// that exists and is broken.

import fs from "node:fs";
import path from "node:path";
import { parseBoard, type Board } from "./board-schema.js";
import type { BoardRef } from "../shared/ipc.js";

/** Where a project's single board lives. Relative, POSIX — joined onto the project root. */
export const BOARD_RELATIVE_PATH = path.join(".claude", "devops-tools.json");

/**
 * Where a project's per-environment boards live, when it has more than one — a separate root
 * module or a `-var-file` selection against a shared root. Each `<id>.json` inside is a complete,
 * independent board; nothing here merges them. Most projects never populate this directory and
 * keep the single `BOARD_RELATIVE_PATH` file instead — `listBoards` returns `[]` for them.
 */
export const BOARD_DIR_RELATIVE_PATH = path.join(".claude", "devops-tools");

export type BoardLoadResult =
  | { status: "ok"; board: Board; boardPath: string; boardRelativePath: string }
  | { status: "missing"; boardPath: string; boardRelativePath: string }
  | {
      status: "invalid";
      errors: string[];
      boardPath: string;
      boardRelativePath: string;
    };

function relativePathFor(boardId?: string): string {
  return boardId
    ? path.join(BOARD_DIR_RELATIVE_PATH, `${boardId}.json`)
    : BOARD_RELATIVE_PATH;
}

/** `boardId` selects a file under `BOARD_DIR_RELATIVE_PATH`; omit it for the single-board path. */
export function boardPathFor(projectRoot: string, boardId?: string): string {
  return path.join(projectRoot, relativePathFor(boardId));
}

export function loadBoard(
  projectRoot: string,
  boardId?: string,
): BoardLoadResult {
  const boardPath = boardPathFor(projectRoot, boardId);
  const boardRelativePath = relativePathFor(boardId);

  let raw: string;
  try {
    raw = fs.readFileSync(boardPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "missing", boardPath, boardRelativePath };
    // EACCES, EISDIR and friends are real problems the user can act on, so they are reported as
    // an invalid board rather than quietly folded into "missing" and shown as "run the skill".
    return {
      status: "invalid",
      errors: [`could not read ${boardPath}: ${(err as Error).message}`],
      boardPath,
      boardRelativePath,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      status: "invalid",
      errors: [
        `${boardRelativePath} is not valid JSON: ${(err as Error).message}`,
      ],
      boardPath,
      boardRelativePath,
    };
  }

  const parsed = parseBoard(data);
  return parsed.ok
    ? { status: "ok", board: parsed.board, boardPath, boardRelativePath }
    : {
        status: "invalid",
        errors: parsed.errors,
        boardPath,
        boardRelativePath,
      };
}

/**
 * Every environment discovered for a project, sorted by id. `[]` for the common case — no
 * `BOARD_DIR_RELATIVE_PATH` directory at all — which is how a caller tells "one board" from
 * "several" without a second flag.
 */
export function listBoards(projectRoot: string): BoardRef[] {
  const dir = path.join(projectRoot, BOARD_DIR_RELATIVE_PATH);
  let names: string[];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  return names.map((name) => {
    const id = name.slice(0, -".json".length);
    const result = loadBoard(projectRoot, id);
    const label =
      result.status === "ok" ? (result.board.project.environment ?? id) : id;
    return { id, relativePath: relativePathFor(id), label };
  });
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
