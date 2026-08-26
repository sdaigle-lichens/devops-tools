// What the canvas and the detail panel agree on: which board is loaded, and what is selected.
//
// Keyed by project root, like maestro's workflow store and for the same reason: a route loader
// re-running within the same project must not blow away the current selection, but switching
// projects must replace the board wholesale or the panel goes on describing a node from the
// project you just left.

import { Store } from "@tanstack/store";
import type { Board, BoardView } from "../../../shared/ipc";

export interface BoardState {
  projectRoot: string | null;
  view: BoardView | null;
  selectedNodeId: string | null;
}

export const boardStore = new Store<BoardState>({
  projectRoot: null,
  view: null,
  selectedNodeId: null,
});

/** Load a view for a project, preserving the selection when it is the same project and node. */
export function setBoardView(projectRoot: string, view: BoardView): void {
  boardStore.setState((prev) => {
    const sameProject = prev.projectRoot === projectRoot;
    const stillPresent =
      sameProject &&
      prev.selectedNodeId !== null &&
      view.status === "ok" &&
      view.board.nodes.some((n) => n.id === prev.selectedNodeId);
    return {
      projectRoot,
      view,
      selectedNodeId: stillPresent ? prev.selectedNodeId : null,
    };
  });
}

export function selectNode(nodeId: string | null): void {
  boardStore.setState((prev) =>
    prev.selectedNodeId === nodeId ? prev : { ...prev, selectedNodeId: nodeId },
  );
}

export function selectedBoard(state: BoardState): Board | null {
  return state.view?.status === "ok" ? state.view.board : null;
}
