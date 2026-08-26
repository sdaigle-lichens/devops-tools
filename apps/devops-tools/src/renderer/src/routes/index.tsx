import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderOpen, TriangleAlert, X } from "lucide-react";
import type { ProjectRef, ProjectState } from "../../../shared/ipc";
import { callMain } from "../utils/call-main";

export const Route = createFileRoute("/")({
  loader: () => window.devopsTools.project.get(),
  component: HomePage,
});

function HomePage() {
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const [state, setState] = useState<ProjectState>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => window.devopsTools.project.onChanged(setState), []);

  const openRoot = useCallback(
    (root: string) => {
      void navigate({ to: "/board", search: { root } });
    },
    [navigate],
  );

  const pick = useCallback(async () => {
    setError(null);
    const result = await callMain(() => window.devopsTools.project.pick());
    if (!result.ok) return setError(result.error);
    // null is a cancelled dialog, which is not a failure and needs no message.
    if (result.value?.current) openRoot(result.value.current.root);
  }, [openRoot]);

  const open = useCallback(
    async (root: string) => {
      setError(null);
      const result = await callMain(() =>
        window.devopsTools.project.open(root),
      );
      if (!result.ok) return setError(result.error);
      openRoot(root);
    },
    [openRoot],
  );

  const forget = useCallback(async (root: string) => {
    const result = await callMain(() =>
      window.devopsTools.project.forget(root),
    );
    if (!result.ok) setError(result.error);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">DevOps Tools</h1>
        <p className="mt-1 text-sm text-(--ink-2)">
          Open a repository that manages AWS with Terraform to see its
          architecture. Nothing here writes to your project.
        </p>
      </header>

      <button
        type="button"
        onClick={() => void pick()}
        className="flex items-center justify-center gap-2 rounded-lg bg-(--accent) px-4 py-3 text-sm font-medium text-(--accent-ink) transition hover:opacity-90"
      >
        <FolderOpen size={16} />
        Open project…
      </button>

      {error && (
        <p
          className="rounded-lg bg-(--danger-bg) px-3 py-2 text-sm text-(--danger)"
          role="alert"
        >
          {error}
        </p>
      )}

      {state.recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-medium tracking-wide text-(--ink-3) uppercase">
            Recent
          </h2>
          <ul className="divide-y divide-(--line) overflow-hidden rounded-lg border border-(--line) bg-(--surface)">
            {state.recent.map((project) => (
              <RecentRow
                key={project.root}
                project={project}
                onOpen={() => void open(project.root)}
                onForget={() => void forget(project.root)}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function RecentRow({
  project,
  onOpen,
  onForget,
}: {
  project: ProjectRef;
  onOpen: () => void;
  onForget: () => void;
}) {
  return (
    <li className="group flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 px-4 py-3 text-left transition hover:bg-(--surface-2)"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {project.name}
          {/* Picking the repo root when the .tf files are three levels down is the easy mistake,
              and it produces an empty board with no explanation. Say so before they open it. */}
          {!project.hasTerraform && (
            <span
              className="flex items-center gap-1 text-xs font-normal text-(--ink-3)"
              title="No .tf files found near this directory"
            >
              <TriangleAlert size={12} />
              no Terraform found
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate font-mono text-xs text-(--ink-3)">
          {project.root}
        </span>
      </button>
      <button
        type="button"
        onClick={onForget}
        aria-label={`Forget ${project.name}`}
        className="mr-2 rounded p-2 text-(--ink-3) opacity-0 transition group-hover:opacity-100 hover:text-(--ink)"
      >
        <X size={14} />
      </button>
    </li>
  );
}
