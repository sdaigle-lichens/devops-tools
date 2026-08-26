import { useStore } from "@tanstack/react-store";
import {
  ChevronRight,
  ExternalLink,
  MousePointerSquareDashed,
} from "lucide-react";
import { containerPath } from "../../../core/board-to-flow";
import type { BoardNode, JsonValue } from "../../../shared/ipc";
import { boardStore, selectedBoard } from "../store/board-store";

/**
 * Terraform attributes are arbitrarily nested — a `tags` map, a list of lifecycle rules, a bare
 * string. Rendered as a tree rather than flattened, because the shape of a rule block is part of
 * what the user came here to read.
 */
function ValueTree({ value }: { value: JsonValue }) {
  if (value === null)
    return <span className="text-(--ink-3) italic">null</span>;
  if (typeof value === "boolean")
    return <span className="font-mono text-(--accent)">{String(value)}</span>;
  if (typeof value === "number")
    return <span className="font-mono">{value}</span>;
  if (typeof value === "string")
    return <span className="font-mono break-all">{value}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-(--ink-3) italic">empty</span>;
    return (
      <ul className="space-y-1 border-l border-(--line) pl-3">
        {value.map((item, i) => (
          <li key={i}>
            <ValueTree value={item} />
          </li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0)
    return <span className="text-(--ink-3) italic">empty</span>;
  return (
    <dl className="space-y-1 border-l border-(--line) pl-3">
      {entries.map(([key, child]) => (
        <div key={key}>
          <dt className="text-[11px] text-(--ink-3)">{key}</dt>
          <dd className="text-xs text-(--ink)">
            <ValueTree value={child} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-(--ink-3) uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DetailPanel() {
  const board = useStore(boardStore, selectedBoard);
  const selectedId = useStore(boardStore, (s) => s.selectedNodeId);
  const node =
    board && selectedId
      ? (board.nodes.find((n) => n.id === selectedId) ?? null)
      : null;

  return (
    <aside className="w-90 shrink-0 overflow-y-auto border-l border-(--line) bg-(--surface)">
      {node && board ? (
        <NodeDetail node={node} breadcrumb={containerPath(board, node.id)} />
      ) : (
        <EmptySelection />
      )}
    </aside>
  );
}

function EmptySelection() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <MousePointerSquareDashed size={24} className="text-(--ink-3)" />
      <p className="text-sm text-(--ink-3)">
        Select an element to see its specs.
      </p>
    </div>
  );
}

function NodeDetail({
  node,
  breadcrumb,
}: {
  node: BoardNode;
  breadcrumb: BoardNode[];
}) {
  const attributes = Object.entries(node.attributes ?? {});
  const tags = Object.entries(node.tags ?? {});

  return (
    <div className="space-y-5 p-4">
      <header>
        {breadcrumb.length > 0 && (
          <nav className="mb-1 flex flex-wrap items-center text-[11px] text-(--ink-3)">
            {breadcrumb.map((ancestor, i) => (
              <span key={ancestor.id} className="flex items-center">
                {i > 0 && <ChevronRight size={10} className="mx-0.5" />}
                {ancestor.label}
              </span>
            ))}
          </nav>
        )}
        <h2 className="text-base leading-tight font-semibold">{node.label}</h2>
        {node.resourceType && (
          <p className="mt-0.5 font-mono text-xs text-(--ink-2)">
            {node.resourceType}
          </p>
        )}
        <p className="mt-1 font-mono text-[11px] break-all text-(--ink-3)">
          {node.id}
        </p>
      </header>

      {node.notes && (
        <Section title="Notes">
          <p className="text-xs leading-relaxed text-(--ink-2)">{node.notes}</p>
        </Section>
      )}

      {attributes.length > 0 && (
        <Section title="Attributes">
          <dl className="space-y-2">
            {attributes.map(([key, value]) => (
              <div key={key}>
                <dt className="text-[11px] text-(--ink-3)">{key}</dt>
                <dd className="text-xs text-(--ink)">
                  <ValueTree value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {tags.length > 0 && (
        <Section title="Tags">
          <ul className="flex flex-wrap gap-1">
            {tags.map(([key, value]) => (
              <li
                key={key}
                className="rounded border border-(--line) bg-(--surface-2) px-1.5 py-0.5 font-mono text-[10px] text-(--ink-2)"
              >
                {key}={value}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {node.source && (
        <Section title="Source">
          <button
            type="button"
            onClick={() =>
              void window.devopsTools.shell.revealInFolder(node.source!.file)
            }
            className="flex items-center gap-1.5 font-mono text-xs text-(--accent) transition hover:underline"
          >
            {node.source.file}
            {node.source.line ? `:${node.source.line}` : ""}
            <ExternalLink size={11} />
          </button>
        </Section>
      )}
    </div>
  );
}
