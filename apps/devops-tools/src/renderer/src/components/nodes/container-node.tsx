import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { containerStyle } from "../../../../core/aws-visuals";
import type { BoardFlowNode } from "../../../../core/board-to-flow";

/**
 * A VPC, availability zone or subnet box.
 *
 * Only the header is clickable. A container is painted behind its children and covers the whole
 * area they sit in, so a full-surface hit target would swallow every click meant for a resource
 * inside it — which reads as "clicking the EC2 selects the subnet" and is maddening.
 *
 * The handles are invisible but load-bearing: a subnet is a container AND an edge endpoint (it
 * associates to a route table), and React Flow drops any edge whose endpoint node has no handle to
 * attach to — silently, with the node still on screen. Four association edges went missing exactly
 * that way.
 */
export const ContainerNode = memo(function ContainerNode({
  data,
  selected,
}: NodeProps<BoardFlowNode>) {
  const { node } = data;
  const style = containerStyle(node.role);

  return (
    <div
      className="pointer-events-none h-full w-full rounded-lg"
      style={{
        border: `2px ${style.dashed ? "dashed" : "solid"} ${style.color}`,
        backgroundColor: `${style.color}0d`,
        boxShadow: selected ? `0 0 0 2px ${style.color}66` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!opacity-0"
      />
      <div
        className="pointer-events-auto inline-flex max-w-full cursor-pointer items-baseline gap-2 overflow-hidden rounded-tl-md rounded-br-md px-2 py-1"
        style={{ backgroundColor: `${style.color}1f` }}
      >
        <span
          className="shrink-0 text-[10px] font-semibold tracking-wide uppercase"
          style={{ color: style.color }}
        >
          {style.heading}
        </span>
        <span className="truncate text-xs font-medium text-(--ink)">
          {node.label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
    </div>
  );
});
