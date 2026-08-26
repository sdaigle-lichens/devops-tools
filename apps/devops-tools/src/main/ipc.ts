// Every channel the renderer can reach, in one file.
//
// Each handler is a thin adapter over src/core, which is what keeps the interesting logic
// testable without an Electron runtime. Nothing here writes to a user's project — the only write
// in the app is project-store's own state file.

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  BOARD_RELATIVE_PATH,
  listBoards,
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
  type BoardRef,
  type BoardView,
  type ProjectState,
} from "../shared/ipc.js";

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(channel, payload);
}

/**
 * Which environment's board is loaded for the current project — there is one live window group
 * per project the same way `project-store`'s "current" is singular, so one module-level id is
 * enough. Reset whenever the project changes; kept as long as it names a board that still exists.
 */
let activeBoardId: string | null = null;

/** Strip the absolute path before a result crosses to the renderer — it only ever displays it. */
function toView(result: BoardLoadResult, boards: BoardRef[]): BoardView {
  switch (result.status) {
    case "ok":
      return {
        status: "ok",
        board: result.board,
        boardRelativePath: result.boardRelativePath,
        boards,
        activeBoardId,
      };
    case "missing":
      return {
        status: "missing",
        boardRelativePath: result.boardRelativePath,
        boards,
      };
    case "invalid":
      return {
        status: "invalid",
        errors: result.errors,
        boardRelativePath: result.boardRelativePath,
        boards,
      };
  }
}

/**
 * Load whichever environment is active for a project, choosing a default the first time one is
 * needed and falling back to the first environment left when the active one disappears (e.g. a
 * skill run renamed or removed it). `requestedBoardId` is honoured only when it names a board
 * `listBoards` actually found — never trusted blindly, since it ends up in a file path.
 */
function loadActive(
  projectRoot: string | null,
  requestedBoardId?: string,
): BoardView {
  if (!projectRoot) {
    activeBoardId = null;
    return {
      status: "missing",
      boardRelativePath: BOARD_RELATIVE_PATH,
      boards: [],
    };
  }

  const boards = listBoards(projectRoot);
  if (requestedBoardId && boards.some((b) => b.id === requestedBoardId)) {
    activeBoardId = requestedBoardId;
  } else if (boards.length === 0) {
    activeBoardId = null;
  } else if (!boards.some((b) => b.id === activeBoardId)) {
    activeBoardId = boards[0].id;
  }

  return toView(loadBoard(projectRoot, activeBoardId ?? undefined), boards);
}

/**
 * Retarget the watcher and tell every window. Called on every project change, so the board file a
 * window is watching is always the project that window is showing.
 */
function announce(state: ProjectState): ProjectState {
  activeBoardId = null; // a new project picks its own default environment
  const root = state.current?.root ?? null;
  watchBoard(root, () => broadcast(IPC_EVENTS.boardChanged, loadActive(root)));
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

  ipcMain.handle(
    IPC.boardLoad,
    (_e, root: string, boardId?: string): BoardView =>
      loadActive(resolveProjectRoot(root) || null, boardId),
  );

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
