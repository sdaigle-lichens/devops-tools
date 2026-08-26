import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { ArrowLeft } from "lucide-react";
import { BoardCanvas } from "../components/board-canvas";
import { DetailPanel } from "../components/detail-panel";
import { EmptyBoard, InvalidBoard } from "../components/board-placeholders";
import { boardStore, setBoardView } from "../store/board-store";

export const Route = createFileRoute("/board")({
  // The root arrives in the URL so the window survives a reload on the same project. Main treats
  // it as a viewing parameter and honours it only for a project the user has actually opened, so
  // a hand-edited hash cannot make the app read somewhere else.
  validateSearch: (search: Record<string, unknown>): { root: string } => ({
    root: typeof search.root === "string" ? search.root : "",
  }),
  loaderDeps: ({ search }) => ({ root: search.root }),
  loader: async ({ deps }) => ({
    root: deps.root,
    view: await window.devopsTools.board.load(deps.root),
  }),
  component: BoardPage,
});

function BoardPage() {
  const { root, view } = Route.useLoaderData();
  const navigate = useNavigate();

  // Seed from the loader, then follow the file. The watcher in main hands us a fresh read whenever
  // .claude/devops-tools.json changes, which is what makes running the update skill in a Claude
  // session next door show up here without a reload.
  useEffect(() => setBoardView(root, view), [root, view]);
  useEffect(
    () =>
      window.devopsTools.board.onChanged((next) => setBoardView(root, next)),
    [root],
  );

  const current = useStore(boardStore, (s) => s.view);
  const projectName = root.split(/[/\\]/).filter(Boolean).pop() ?? root;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--line) bg-(--surface) px-4 py-2.5">
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-(--ink-2) transition hover:bg-(--surface-2) hover:text-(--ink)"
        >
          <ArrowLeft size={14} />
          Projects
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{projectName}</h1>
          <p className="truncate font-mono text-xs text-(--ink-3)">{root}</p>
        </div>
        <span className="ml-auto rounded-full border border-(--line) px-2 py-0.5 text-xs text-(--ink-3)">
          read-only
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {current?.status === "ok" && (
          <>
            <div className="min-w-0 flex-1">
              <BoardCanvas board={current.board} />
            </div>
            <DetailPanel />
          </>
        )}
        {current?.status === "missing" && (
          <EmptyBoard boardRelativePath={current.boardRelativePath} />
        )}
        {current?.status === "invalid" && (
          <InvalidBoard
            errors={current.errors}
            boardRelativePath={current.boardRelativePath}
          />
        )}
      </div>
    </div>
  );
}
