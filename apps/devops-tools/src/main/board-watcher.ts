// Watches the open project's board file(s) so the canvas follows a Claude session.
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
//
// A project with more than one environment keeps its boards under `.claude/devops-tools/` instead
// of the single `.claude/devops-tools.json` file, and a non-recursive watch on `.claude/` never
// sees a write to a file inside that subdirectory — only the subdirectory's own
// create/rename/delete. So the environments directory gets the identical bootstrap treatment,
// one level down: watch `.claude/` for it to appear, then watch it directly for its `*.json`
// files changing.
//
// The callback carries no payload on purpose — "something changed" is all a filesystem watch can
// honestly say once there may be several files behind it. The caller re-derives whatever view it
// currently has selected, which is also the only place that knows which environment is active.

import fs from "node:fs";
import path from "node:path";
import {
  BOARD_DIR_RELATIVE_PATH,
  BOARD_RELATIVE_PATH,
} from "../core/board-loader.js";

const DEBOUNCE_MS = 200;
const CLAUDE_DIRNAME = path.dirname(BOARD_RELATIVE_PATH); // ".claude"
const BOARD_BASENAME = path.basename(BOARD_RELATIVE_PATH); // "devops-tools.json"
const BOARDS_DIRNAME = path.basename(BOARD_DIR_RELATIVE_PATH); // "devops-tools"

let claudeWatcher: fs.FSWatcher | null = null;
let boardsWatcher: fs.FSWatcher | null = null;
let rootWatcher: fs.FSWatcher | null = null;
let timer: NodeJS.Timeout | null = null;
let watchedRoot: string | null = null;
let onChangeCb: (() => void) | null = null;

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function fire(projectRoot: string): void {
  if (watchedRoot !== projectRoot) return;
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    onChangeCb?.();
  }, DEBOUNCE_MS);
}

/**
 * Try to watch `<projectRoot>/.claude/devops-tools/` directly. Safe to call when it does not
 * exist yet or is already watched — the caller retries this on every `.claude/` event, since that
 * is the only signal that the directory has just appeared.
 */
function startBoardsWatch(projectRoot: string): void {
  if (boardsWatcher) return;
  const dir = path.join(projectRoot, BOARD_DIR_RELATIVE_PATH);
  try {
    const w = fs.watch(dir, (_event, filename) => {
      if (filename && !filename.endsWith(".json")) return;
      fire(projectRoot);
    });
    w.on("error", () => {
      if (boardsWatcher === w) boardsWatcher = null;
    });
    boardsWatcher = w;
  } catch {
    // Not there yet, or went away between the readdir this doesn't do and here. The next
    // `.claude/` event naming this directory tries again.
  }
}

/**
 * Try to watch `<projectRoot>/.claude/` directly. Returns whether it succeeded — the caller falls
 * back to watching the root when it did not.
 */
function startClaudeWatch(projectRoot: string): boolean {
  const dir = path.join(projectRoot, CLAUDE_DIRNAME);
  try {
    const w = fs.watch(dir, (_event, filename) => {
      // A rename event can arrive with a null filename on some platforms; treating that as a hit
      // costs one wasted read and is the difference between a watcher that works everywhere and
      // one that works on Linux.
      if (filename === BOARDS_DIRNAME) startBoardsWatch(projectRoot);
      if (
        !filename ||
        filename === BOARD_BASENAME ||
        filename === BOARDS_DIRNAME
      ) {
        fire(projectRoot);
      }
    });
    w.on("error", () => {
      if (claudeWatcher === w) claudeWatcher = null;
    });
    claudeWatcher?.close();
    claudeWatcher = w;
    // The environments directory may already exist by the time this runs — a fresh `openProject`
    // races no "just created .claude" event to trigger the check above.
    startBoardsWatch(projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** No `.claude/` yet — watch the root for it to appear, then hand off to the `.claude/` watch. */
function startRootWatch(projectRoot: string): void {
  try {
    const w = fs.watch(projectRoot, (_event, filename) => {
      if (filename && filename !== CLAUDE_DIRNAME) return;
      if (watchedRoot !== projectRoot) return;
      // Might still fail (e.g. the entry was something else briefly named `.claude`, or the
      // create event fired before the directory was fully in place) — the root watch stays live
      // either way, since `startClaudeWatch` only replaces `claudeWatcher` on success.
      startClaudeWatch(projectRoot);
    });
    w.on("error", () => {
      if (rootWatcher === w) rootWatcher = null;
    });
    rootWatcher = w;
  } catch {
    rootWatcher = null;
  }
}

/**
 * Point the watcher at a project, replacing whatever it was watching. Pass null to stop.
 * `onChange` fires, debounced, whenever the project's board file(s) may have changed — a single
 * save often produces several events, and it carries no payload: the caller already knows which
 * environment it has selected and re-reads that one.
 */
export function watchBoard(
  projectRoot: string | null,
  onChange: () => void,
): void {
  stopWatchingBoard();
  if (!projectRoot) return;

  watchedRoot = projectRoot;
  onChangeCb = onChange;
  if (!startClaudeWatch(projectRoot)) {
    startRootWatch(projectRoot);
  }
}

export function stopWatchingBoard(): void {
  clearTimer();
  claudeWatcher?.close();
  claudeWatcher = null;
  boardsWatcher?.close();
  boardsWatcher = null;
  rootWatcher?.close();
  rootWatcher = null;
  watchedRoot = null;
  onChangeCb = null;
}
