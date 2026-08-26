// The bridge, and deliberately the dullest file in the app.
//
// One namespace, one line per channel, no generic `invoke(channel, ...args)` escape hatch — a
// passthrough would make every other guard here decorative, since the renderer could then reach
// any channel main happens to have registered. test/isolation.test.ts asserts both properties.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, IPC_EVENTS } from "../shared/ipc.js";
import type { BoardView, DevopsToolsApi, ProjectState } from "../shared/ipc.js";

/** Subscribe to a push channel, handing back the unsubscribe. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DevopsToolsApi = {
  project: {
    get: () => ipcRenderer.invoke(IPC.projectGet),
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    open: (root: string) => ipcRenderer.invoke(IPC.projectOpen, root),
    forget: (root: string) => ipcRenderer.invoke(IPC.projectForget, root),
    onChanged: (cb) => subscribe<ProjectState>(IPC_EVENTS.projectChanged, cb),
  },
  board: {
    load: (root: string, boardId?: string) =>
      ipcRenderer.invoke(IPC.boardLoad, root, boardId),
    onChanged: (cb) => subscribe<BoardView>(IPC_EVENTS.boardChanged, cb),
  },
  shell: {
    revealInFolder: (relativePath: string) =>
      ipcRenderer.invoke(IPC.revealInFolder, relativePath),
  },
};

contextBridge.exposeInMainWorld("devopsTools", api);
