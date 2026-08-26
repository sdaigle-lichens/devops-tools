// Watches the open project's board file so the canvas follows a Claude session.
//
// The intended workflow is two windows side by side: this app showing the board, and a Claude
// session running `/devops-tools:update-devops-tools` after a Terraform change. Without a watcher
// the user has to know to reopen the project; with one, the diagram just updates.
//
// `fs.watch` on the FILE, not the directory, would stop working the moment an editor or a skill
// replaces it via write-to-temp-then-rename — the watch follows the old inode. So the watch is on
// `.claude/`, filtered by name. That directory is small and quiet, which is why this is affordable.
//
// A project that has never run the init skill has no `.claude/` yet, and `fs.watch` throws on a
// path that does not exist. That is exactly the primary onboarding path — open an unmapped
// project, run the init skill, the board should just appear — so falling back to "nothing to
// watch" is not acceptable. Instead the watch falls back to the project ROOT, filtered to the
// single entry named `.claude`, and hands off to the directory watch the moment that entry shows
// up. The root is not watched recursively (recursive `fs.watch` is not available on Linux), so
// this costs one extra inotify handle on the project root until init runs, not a directory tree
// walk.

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
 * Try to watch `<projectRoot>/.claude/` directly. Returns whether it succeeded — the caller falls
 * back to watching the root when it did not.
 */
function startDirectoryWatch(
  projectRoot: string,
  onChange: (result: BoardLoadResult) => void,
): boolean {
  const dir = path.join(projectRoot, BOARD_DIRNAME);
  try {
    const dirWatcher = fs.watch(dir, (_event, filename) => {
      // A rename event can arrive with a null filename on some platforms; treating that as a hit
      // costs one wasted read and is the difference between a watcher that works everywhere and
      // one that works on Linux.
      if (filename && filename !== BOARD_BASENAME) return;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (watchedRoot === projectRoot) onChange(loadBoard(projectRoot));
      }, DEBOUNCE_MS);
    });
    watcher?.close();
    watcher = dirWatcher;
    return true;
  } catch {
    return false;
  }
}

/** No `.claude/` yet — watch the root for it to appear, then hand off to the directory watch. */
function startRootWatch(
  projectRoot: string,
  onChange: (result: BoardLoadResult) => void,
): void {
  try {
    watcher = fs.watch(projectRoot, (_event, filename) => {
      if (filename && filename !== BOARD_DIRNAME) return;
      if (watchedRoot !== projectRoot) return;
      // Might still fail (e.g. the entry was something else briefly named `.claude`, or the
      // create event fired before the directory was fully in place) — the root watch stays live
      // either way, since `startDirectoryWatch` only replaces `watcher` on success.
      startDirectoryWatch(projectRoot, onChange);
    });
  } catch {
    watcher = null;
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

  watchedRoot = projectRoot;
  if (!startDirectoryWatch(projectRoot, onChange)) {
    startRootWatch(projectRoot, onChange);
  }
}

export function stopWatchingBoard(): void {
  clearTimer();
  watcher?.close();
  watcher = null;
  watchedRoot = null;
}
