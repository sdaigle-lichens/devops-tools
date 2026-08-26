// Watches the open project's board file so the canvas follows a Claude session.
//
// The intended workflow is two windows side by side: this app showing the board, and a Claude
// session running `/devops-tools:update-devops-tools` after a Terraform change. Without a watcher
// the user has to know to reopen the project; with one, the diagram just updates.
//
// `fs.watch` on the FILE, not the directory, would stop working the moment an editor or a skill
// replaces it via write-to-temp-then-rename — the watch follows the old inode. So the watch is on
// `.claude/`, filtered by name. That directory is small and quiet, which is why this is affordable.

import fs from "node:fs";
import path from "node:path";
import {
  BOARD_RELATIVE_PATH,
  loadBoard,
  type BoardLoadResult,
} from "../core/board-loader.js";

const DEBOUNCE_MS = 200;
const BOARD_BASENAME = path.basename(BOARD_RELATIVE_PATH);
const BOARD_DIRNAME = path.dirname(BOARD_RELATIVE_PATH);

let watcher: fs.FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;
let watchedRoot: string | null = null;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Point the watcher at a project, replacing whatever it was watching. Pass null to stop.
 * `onChange` fires with a fresh read, debounced — a single save often produces several events.
 */
export function watchBoard(
  projectRoot: string | null,
  onChange: (result: BoardLoadResult) => void,
): void {
  stopWatchingBoard();
  if (!projectRoot) return;

  const dir = path.join(projectRoot, BOARD_DIRNAME);
  watchedRoot = projectRoot;

  try {
    watcher = fs.watch(dir, (_event, filename) => {
      // A rename event can arrive with a null filename on some platforms; treating that as a hit
      // costs one wasted read and is the difference between a watcher that works everywhere and
      // one that works on Linux.
      if (filename && filename !== BOARD_BASENAME) return;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (watchedRoot) onChange(loadBoard(watchedRoot));
      }, DEBOUNCE_MS);
    });
  } catch {
    // No `.claude/` yet is the normal state for a project that has never run the init skill.
    // There is nothing to watch and nothing to report — the user will reopen the project after
    // running it, and the load path handles the rest.
    watcher = null;
  }
}

export function stopWatchingBoard(): void {
  clearTimer();
  watcher?.close();
  watcher = null;
  watchedRoot = null;
}
