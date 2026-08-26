// Every channel the renderer can reach, in one file.
//
// Each handler is a thin adapter over src/core, which is what keeps the interesting logic
// testable without an Electron runtime. Nothing here writes to a user's project — the only write
// in the app is project-store's own state file.

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  BOARD_RELATIVE_PATH,
  loadBoard,
  type BoardLoadResult,
} from "../core/board-loader.js";
import { stopWatchingBoard, watchBoard } from "./board-watcher.js";
import {
  forgetProject,
  getState,
  openProject,
  resolveProjectRoot,
} from "./project-store.js";
import {
  IPC,
  IPC_EVENTS,
  type BoardView,
  type ProjectState,
} from "../shared/ipc.js";

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(channel, payload);
}

/** Strip the absolute path before a result crosses to the renderer — it only ever displays it. */
function toView(result: BoardLoadResult): BoardView {
  const boardRelativePath = BOARD_RELATIVE_PATH;
  switch (result.status) {
    case "ok":
      return { status: "ok", board: result.board, boardRelativePath };
    case "missing":
      return { status: "missing", boardRelativePath };
    case "invalid":
      return { status: "invalid", errors: result.errors, boardRelativePath };
  }
}

/**
 * Retarget the watcher and tell every window. Called on every project change, so the board file a
 * window is watching is always the project that window is showing.
 */
function announce(state: ProjectState): ProjectState {
  watchBoard(state.current?.root ?? null, (result) =>
    broadcast(IPC_EVENTS.boardChanged, toView(result)),
  );
  broadcast(IPC_EVENTS.projectChanged, state);
  return state;
}

export function registerIpc(): void {
  ipcMain.handle(IPC.projectGet, (): ProjectState => getState());

  ipcMain.handle(IPC.projectPick, async (): Promise<ProjectState | null> => {
    const res = await dialog.showOpenDialog({
      title: "Open project",
      buttonLabel: "Open",
      properties: ["openDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return announce(openProject(res.filePaths[0]));
  });

  ipcMain.handle(IPC.projectOpen, (_e, root: string): ProjectState =>
    announce(openProject(root)),
  );

  ipcMain.handle(IPC.projectForget, (_e, root: string): ProjectState =>
    announce(forgetProject(root)),
  );

  ipcMain.handle(IPC.boardLoad, (_e, root: string): BoardView => {
    const projectRoot = resolveProjectRoot(root);
    if (!projectRoot)
      return { status: "missing", boardRelativePath: BOARD_RELATIVE_PATH };
    return toView(loadBoard(projectRoot));
  });

  ipcMain.handle(IPC.revealInFolder, (_e, relativePath: string): void => {
    const projectRoot = resolveProjectRoot();
    if (!projectRoot) return;
    // The renderer names a path INSIDE the project and never an absolute one, so the containment
    // check below is the whole authorization. `path.resolve` collapses any `..` the board file
    // might carry — a board is data from a repository, not something to be trusted with a path.
    const target = path.resolve(projectRoot, relativePath);
    const relative = path.relative(projectRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      console.warn(
        `[shell] refusing to reveal outside the project: ${relativePath}`,
      );
      return;
    }
    shell.showItemInFolder(target);
  });

  // A window that opens while a project is already current has to be told what to watch.
  announce(getState());
}

export function disposeIpc(): void {
  stopWatchingBoard();
}
