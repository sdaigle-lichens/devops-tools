import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MAX_SUMMARY_ROWS,
  type BoardFlowNode,
} from "../../../../core/board-to-flow";
import type { JsonValue } from "../../../../shared/ipc";

/** One line of a value on the node face. Objects and arrays are the panel's job, not the node's. */
function inline(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "object")
    return Array.isArray(value) ? `${value.length} item(s)` : "{…}";
  return String(value);
}

/**
 * A leaf AWS resource.
 *
 * Fills the box the layout script sized for it — `h-full w-full`, not a min-width — because that
 * layout placed this node's neighbours on a grid using the size it assumed. A node that grew to
 * fit a long label would overlap the one beside it while the board JSON still looked correct.
 * `MAX_SUMMARY_ROWS` is the other half of that contract: the layout adds a row of height per
 * summary line, up to the same limit.
 *
 * Handles are rendered but never connectable — React Flow needs them as anchor points for the
 * edges the board declares, and the app has no way to create one.
 */
export const ResourceNode = memo(function ResourceNode({
  data,
  selected,
}: NodeProps<BoardFlowNode>) {
  const { node } = data;
  const summary = (node.summary ?? []).slice(0, MAX_SUMMARY_ROWS);

  return (
    <div
      className="h-full w-full overflow-hidden rounded-md border bg-(--surface) px-3 py-2 shadow-sm transition"
      style={{
        borderColor: selected ? "var(--accent)" : "var(--line)",
        boxShadow: selected
          ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)"
          : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-(--line-strong)"
      />
      <div className="truncate text-sm leading-tight font-medium text-(--ink)">
        {node.label}
      </div>
      {node.resourceType && (
        <div className="truncate font-mono text-[10px] text-(--ink-3)">
          {node.resourceType}
        </div>
      )}
      {summary.length > 0 && (
        <dl className="mt-1 border-t border-(--line) pt-1">
          {summary.map((key) => (
            <div
              key={key}
              className="flex h-4 items-baseline gap-1.5 text-[10px] leading-none"
            >
              <dt className="shrink-0 text-(--ink-3)">{key}</dt>
              <dd className="truncate font-mono text-(--ink-2)">
                {inline(node.attributes?.[key] ?? null)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-(--line-strong)"
      />
    </div>
  );
});

/**
 * Something outside the Terraform's account — the internet, a CDN edge, an on-prem network. Drawn
 * as a dashed pill so it never reads as infrastructure this project manages.
 */
export const ExternalNode = memo(function ExternalNode({
  data,
  selected,
}: NodeProps<BoardFlowNode>) {
  const { node } = data;
  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-dashed bg-(--surface-2) px-4 text-sm text-(--ink-2)"
      style={{ borderColor: selected ? "var(--accent)" : "var(--line-strong)" }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-(--line-strong)"
      />
      <span className="truncate">{node.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-1.5 !w-1.5 !border-0 !bg-(--line-strong)"
      />
    </div>
  );
});
