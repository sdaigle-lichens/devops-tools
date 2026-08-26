import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import {
  boardToFlowEdges,
  boardToFlowNodes,
} from "../../../core/board-to-flow";
import { containerLegend } from "../../../core/aws-visuals";
import type { Board } from "../../../shared/ipc";
import { selectNode } from "../store/board-store";
import { useColorMode } from "../utils/use-color-mode";
import { ContainerNode } from "./nodes/container-node";
import { ExternalNode, ResourceNode } from "./nodes/resource-node";

// Declared at module level so React Flow never sees a new object identity and remounts every node
// on each render. The keys are the `kind` values from the board schema.
const NODE_TYPES = {
  container: ContainerNode,
  resource: ResourceNode,
  external: ExternalNode,
};

/**
 * `fitView` as a prop only fires on mount. Loading a different project into an already-mounted
 * canvas leaves the viewport wherever the previous board left it, which usually means staring at
 * empty space. This refits whenever the board identity changes.
 */
function FitViewOnBoardChange({ boardKey }: { boardKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // A frame late on purpose: nodes have to be measured before their bounding box is meaningful.
    const timer = setTimeout(
      () => void fitView({ padding: 0.15, duration: 200 }),
      50,
    );
    return () => clearTimeout(timer);
  }, [boardKey, fitView]);
  return null;
}

export function BoardCanvas({ board }: { board: Board }) {
  const colorMode = useColorMode();
  const nodes = useMemo(() => boardToFlowNodes(board), [board]);
  const edges = useMemo(() => boardToFlowEdges(board), [board]);
  const legend = useMemo(
    () =>
      containerLegend().filter((entry) =>
        board.nodes.some((n) => n.role === entry.role),
      ),
    [board],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        // The board is a rendering of a file on disk, and there is nowhere to persist a change to.
        // Set here as well as per-node in boardToFlowNodes: this pair is the one a reader checks.
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        colorMode={colorMode}
        onNodeClick={(_e, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        proOptions={{ hideAttribution: false }}
      >
        <FitViewOnBoardChange
          boardKey={`${board.project.name}:${board.nodes.length}`}
        />
        <Background />
        <Controls showInteractive={false} />
        {legend.length > 0 && (
          <Panel position="top-right">
            <ul className="flex flex-col gap-1 rounded-md border border-(--line) bg-(--surface) px-3 py-2 text-[11px] text-(--ink-2)">
              {legend.map(({ role, style }) => (
                <li key={role} className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-[3px]"
                    style={{
                      border: `2px ${style.dashed ? "dashed" : "solid"} ${style.color}`,
                      backgroundColor: `${style.color}1f`,
                    }}
                  />
                  {style.heading}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </ReactFlow>
    </ReactFlowProvider>
  );
}
