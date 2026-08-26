// The process boundary, declared once.
//
// Imported by all three processes, so it must stay type-only plus plain const objects: the
// renderer compiles this file, and anything that dragged in node would take the renderer with it.
// The channel maps below are the whole vocabulary — test/isolation.test.ts asserts the preload
// bridge invokes nothing that is not named here, which is what stops the surface widening by
// accident.

import type { Board } from "../core/board-schema.js";

export type {
  Board,
  BoardNode,
  BoardEdge,
  FoldedResource,
  ContainerRole,
  JsonValue,
} from "../core/board-schema.js";

/** A project the user has opened. `root` is absolute and already resolved. */
export interface ProjectRef {
  root: string;
  name: string;
  /** ISO 8601. Display only — recency is already encoded in the order of `recent`. */
  lastOpened: string;
  /** Whether any `.tf` file was found under the root when it was opened. */
  hasTerraform: boolean;
}

export interface ProjectState {
  current: ProjectRef | null;
  recent: ProjectRef[];
}

/**
 * The renderer's view of a board read attempt. Mirrors core's `BoardLoadResult` minus the
 * absolute `boardPath`, which the renderer gets as a display string only.
 */
export type BoardView =
  | { status: "ok"; board: Board; boardRelativePath: string }
  | { status: "missing"; boardRelativePath: string }
  | { status: "invalid"; errors: string[]; boardRelativePath: string };

/** Request → response channels. */
export const IPC = {
  projectGet: "project:get",
  projectPick: "project:pick",
  projectOpen: "project:open",
  projectForget: "project:forget",
  boardLoad: "board:load",
  revealInFolder: "shell:reveal",
} as const;

/** Push channels: main → renderer. */
export const IPC_EVENTS = {
  projectChanged: "project:changed",
  boardChanged: "board:changed",
} as const;

/** The surface exposed on `window.devopsTools` by the preload script. */
export interface DevopsToolsApi {
  project: {
    get(): Promise<ProjectState>;
    /** Opens the OS directory picker. Resolves null when the user cancels. */
    pick(): Promise<ProjectState | null>;
    open(root: string): Promise<ProjectState>;
    forget(root: string): Promise<ProjectState>;
    onChanged(cb: (state: ProjectState) => void): () => void;
  };
  board: {
    load(root: string): Promise<BoardView>;
    /**
     * Fires when the open project's board file changes on disk — which is what happens when the
     * user runs the update skill in a Claude session with this window open. The payload is the
     * fresh read, so a subscriber never has to go ask for it.
     */
    onChanged(cb: (view: BoardView) => void): () => void;
  };
  shell: {
    /** Opens the OS file manager on a path inside the open project. */
    revealInFolder(relativePath: string): Promise<void>;
  };
}
