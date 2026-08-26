# apps/devops-tools

The Electron app. `electron-vite` on Vite 8; React 19 + TanStack Router (hash history) in the
renderer; `@xyflow/react` for the canvas.

## The three processes

```
src/shared/ipc.ts     the contract — channel maps + the API interface. Type-only imports, so the
                      renderer can compile it.
src/preload/index.ts  one exposeInMainWorld("devopsTools"), one line per channel, no generic
                      invoke() passthrough.
src/main/ipc.ts       thin ipcMain.handle adapters over src/core.
src/core/             pure + node. No electron import anywhere. This is where the logic lives, and
                      why vitest runs in the node environment with no jsdom.
```

`test/isolation.test.ts` asserts all of it by reading source text — the security flags, the single
preload namespace, the absence of an `invoke` escape hatch, the renderer importing no node
builtins, and the read-only guarantee. These are properties of configuration, not of code that
would fail loudly if it regressed.

### The renderer-safe surface of `src/core`

`board-schema.ts`, `board-to-flow.ts`, `aws-visuals.ts` — and nothing else, because
`board-loader.ts` imports `node:fs`. That list appears twice, deliberately:

- `tsconfig.web.json` names the files, so a renderer that imported `board-loader` would not compile.
- `RENDERER_SAFE` in `test/isolation.test.ts` names them again, so it fails on the import rather
  than on a type error three files away.

Keep the two in step.

## Things that will bite you

**`electron.vite.config.ts` hand-rolls `rollupOptions.external`.** `externalizeDepsPlugin`'s
externals silently no-op under Vite 8 — it assigns `config.build` from the `config` hook, which no
longer reaches the resolved ssr environment. With zero runtime `dependencies` today an empty list
is indistinguishable from an ignored one, so the failure is latent, not absent. The comments in
that file are the explanation; do not trim them.

**Hash history is required.** The packaged renderer loads over `file://`, where a pushState path
resolves to nothing and the app comes up blank. Dev, served over http, never shows you this.

**React Flow does not inherit the theme.** It takes a `colorMode` prop; left unset its light
palette renders over a dark app and the `Controls` icons are invisible. `useColorMode()` watches
the `class` attribute on `<html>`, which `public/theme-bootstrap.js` sets before first paint.

**`fitView` only fires on mount.** Loading a different board into a mounted canvas leaves the
viewport where the last one left it. `FitViewOnBoardChange` handles that, one frame late so nodes
are measured first.

**Containers must be behind their children.** `boardToFlowNodes` gives containers `zIndex: 0` and
everything else `zIndex: 1`, and `ContainerNode` is `pointer-events: none` except on its header —
a container covers the whole area its children sit in, so without both it swallows every click.

**The board watcher watches `.claude/`, not the file.** A skill that writes via temp-file-and-rename
would leave an `fs.watch` on the file following a dead inode.
