// Turning an IPC rejection back into a message worth showing someone.
//
// `ipcMain.handle` rejections arrive in the renderer wrapped: the message becomes
// `Error invoking remote method 'board:load': Error: ENOENT ...`, which is Electron's plumbing
// leaking into a user-facing string. Stripped here, in the renderer, rather than in the preload —
// a generic wrapper there would look exactly like the escape hatch the isolation test forbids.

const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

export function mainErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(REMOTE_PREFIX, "").trim() || "Something went wrong.";
}

export type CallResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

export async function callMain<T>(
  op: () => Promise<T>,
): Promise<CallResult<T>> {
  try {
    return { ok: true, value: await op() };
  } catch (err) {
    return { ok: false, error: mainErrorMessage(err) };
  }
}
