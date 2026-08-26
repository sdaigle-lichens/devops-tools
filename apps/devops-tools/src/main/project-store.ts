// The active project and the recent-projects list, persisted in the app's userData dir.
//
// This is the ONE file in the app allowed to write anything, and what it writes is the app's own
// state in its own directory — never a byte inside a user's repository. test/isolation.test.ts
// asserts that, because "read-only" is a promise the code has to keep on its own.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { looksLikeTerraformProject } from "../core/board-loader.js";
import type { ProjectRef, ProjectState } from "../shared/ipc.js";

const MAX_RECENT = 10;

function stateFile(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function isProjectRef(v: unknown): v is ProjectRef {
  return (
    !!v && typeof v === "object" && typeof (v as ProjectRef).root === "string"
  );
}

function read(): ProjectState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const s = parsed as Partial<ProjectState>;
    return {
      current: isProjectRef(s.current) ? s.current : null,
      recent: Array.isArray(s.recent) ? s.recent.filter(isProjectRef) : [],
    };
  } catch {
    return { current: null, recent: [] };
  }
}

function write(state: ProjectState): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

/**
 * Drop remembered projects whose directory no longer resolves, so the UI never offers a dead
 * path. Applied once when the file is first loaded, NOT on every read: `getState()` is called from
 * every IPC handler, so filtering there would mean an `existsSync` per remembered project per
 * call — and, worse, rewriting projects.json as a side effect of a read. Anything that changes the
 * list writes it explicitly below.
 */
function prune(state: ProjectState): ProjectState {
  return {
    current:
      state.current && fs.existsSync(state.current.root) ? state.current : null,
    recent: state.recent.filter((r) => fs.existsSync(r.root)),
  };
}

let cached: ProjectState | null = null;

export function getState(): ProjectState {
  if (!cached) cached = prune(read());
  return cached;
}

export function currentRoot(): string {
  return getState().current?.root ?? "";
}

/** Open a project: make it current and move it to the head of the recent list. */
export function openProject(root: string): ProjectState {
  const resolved = path.resolve(root);
  const ref: ProjectRef = {
    root: resolved,
    name: path.basename(resolved),
    lastOpened: new Date().toISOString(),
    hasTerraform: looksLikeTerraformProject(resolved),
  };
  const prev = getState();
  cached = {
    current: ref,
    recent: [ref, ...prev.recent.filter((r) => r.root !== resolved)].slice(
      0,
      MAX_RECENT,
    ),
  };
  write(cached);
  return cached;
}

export function forgetProject(root: string): ProjectState {
  const resolved = path.resolve(root);
  const prev = getState();
  cached = {
    current: prev.current?.root === resolved ? null : prev.current,
    recent: prev.recent.filter((r) => r.root !== resolved),
  };
  write(cached);
  return cached;
}

/**
 * Turn a renderer-supplied project root into one this process is willing to read.
 *
 * A root arriving over IPC is a VIEWING parameter, not an authorization: honoured only when it is
 * a project the user has actually opened. Without this, any renderer bug — or anything that ever
 * managed to run in the renderer — could read `.claude/devops-tools.json` out of an arbitrary
 * directory by asking nicely. Falls back to the current project rather than throwing, because the
 * legitimate way to hit this is a stale route param after the project changed.
 */
export function resolveProjectRoot(requested?: string): string {
  if (!requested) return currentRoot();
  const resolved = path.resolve(requested);
  const state = getState();
  const known = [state.current, ...state.recent].some(
    (r) => r?.root === resolved,
  );
  if (known) return resolved;
  console.warn(`[project] ignoring unknown project root: ${resolved}`);
  return currentRoot();
}
