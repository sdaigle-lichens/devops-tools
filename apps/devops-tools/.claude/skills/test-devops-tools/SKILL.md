---
name: test-devops-tools
description: "Drive the DevOps Tools desktop app in a real Electron window over the Chrome DevTools Protocol to test what no unit test can reach — nested container layout, click-through on a canvas of stacked boxes, the detail panel, theme, and the live reload that fires when a skill rewrites the board file. Use when verifying UI behaviour in a running window, reproducing a canvas or rendering bug, checking a change works in the packaged build, or when a claim about the app can only be settled by looking at a rendered window."
---

# Test the DevOps Tools window

`apps/devops-tools/test/` covers the schema, the loader and the model→React Flow adapter, and
none of it can reach the canvas. React Flow measures the DOM; the layout script places siblings on
a grid using sizes it _assumed_; a container is painted over the whole area its children occupy.
Anything of the form _"does it look right / lay out right / respond right"_ has to be answered by
driving a window.

**Decide it with evidence, not with reasoning about the code.** The first run of `probe.mjs`
found four defects that every unit test passed straight through:

| what the probe saw                 | what it actually was                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 9 of 13 edges rendered             | container nodes had no `<Handle>`, and React Flow silently drops an edge whose endpoint has nowhere to attach |
| two route tables overlapping       | the DOM node grew to 204px against the 180px the layout assumed, so the grid put it on its neighbour          |
| the panel had no source link       | _probe bug_ — a `.slice(0, 400)` cut the text before the link                                                 |
| clicking the pane did not deselect | _probe bug_ — the click landed on React Flow's zoom button, which sits bottom-left                            |

Two app bugs, two harness bugs. Both kinds are found the same way, and neither was visible in the
JSON, the types, or the source.

## Prerequisites

1. **Build first, and test the packaged build, not `dev`.**

   ```bash
   pnpm --filter devops-tools build
   ```

   `main/index.ts` calls `loadURL()` when `ELECTRON_RENDERER_URL` is set and `loadFile()`
   otherwise, so `pnpm dev` serves the renderer over `http://localhost:5173` and **never touches
   the `file://` path that ships**. CSP, asset resolution and code-split chunk paths only fail in
   the packaged load. The harness launches `electron <appDir>` against `out/`.

2. **The Electron sandbox needs its setuid bit** (once per install that re-extracts Electron).
   pnpm does not preserve it, and the app aborts with _"The SUID sandbox helper binary was found,
   but is not configured correctly."_ It needs root, so hand it to the user:

   ```bash
   sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   ```

   `ls -l` should then show `-rwsr-xr-x` and `root root`. **Do not work around it with
   `--no-sandbox`** — OS-level renderer isolation is the premise `test/isolation.test.ts` spends
   four assertions defending, and a run without it does not reflect how the app ships.

## Quick start

```bash
node apps/devops-tools/.claude/skills/test-devops-tools/scripts/probe.mjs
```

It builds its own three fixtures, asserts twenty-four things about a real window, and exits
non-zero on any failure. Run it first — it is the fastest check that the harness and the app still
agree. Then copy it to the scratchpad and edit it for whatever you are actually investigating:

```bash
cp apps/devops-tools/.claude/skills/test-devops-tools/scripts/probe.mjs "$SCRATCHPAD/probe.mjs"
```

Import `cdp.mjs` by absolute path from the scratchpad; it has no dependencies (Node 22's global
`WebSocket` speaks CDP, which is why nothing was added to the repo for this).

## The harness — `scripts/cdp.mjs`

| Export                                                         | Purpose                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `withApp({appDir, electron, port, userDataDir}, fn)`           | Launch, connect, run `fn(cdp, {errors, logs})`, always kill the process.             |
| `openProjectAt(cdp, root)`                                     | Open a project **without the native folder dialog**, then navigate to its board.     |
| `cdp.eval(body)`                                               | Async function body evaluated in the page; use `return`, and `await` works.          |
| `cdp.waitFor(expr, {label})`                                   | Poll until truthy. Always prefer this to a fixed sleep.                              |
| `cdp.geometry()`                                               | Node ids, types, flow-space positions, screen rects, edge count, viewport transform. |
| `cdp.panel()`                                                  | What the detail panel is showing: heading, section headings, full text.              |
| `cdp.emptyPanePoint()`                                         | A point that is genuinely bare canvas — see the trap below.                          |
| `cdp.click(x, y)` / `cdp.clickElement(fn)` / `cdp.jsClick(fn)` | Input.                                                                               |
| `containedIn(inner, outer)` / `overlaps(a, b)`                 | Rect predicates, for asserting containment and non-overlap.                          |

Use a **fresh `--user-data-dir` per run** and a distinct port. The profile is where the app
remembers open and recent projects, so a stale one silently changes what a probe starts from.

## Recipes

**Open a project and land on the canvas.** Routing is hash history, and the board route takes the
project root as a search param that main re-validates against the projects it knows — so the
`project.open` call has to come first, which is what `openProjectAt` does.

```js
await openProjectAt(cdp, "/home/you/gits/fixture");
await cdp.waitFor(`document.querySelectorAll(".react-flow__node").length > 0`);
```

**Assert the nesting is real.** The single most valuable check here, because a board whose
parent-relative coordinates were read as absolute still validates, still renders every node, and
looks like scattered boxes:

```js
const byId = new Map((await cdp.geometry()).nodes.map((n) => [n.id, n]));
const escaped = board.nodes
  .filter((n) => n.parentId)
  .filter((n) => !containedIn(byId.get(n.id), byId.get(n.parentId), 2));
```

**Assert the DOM matches the declared size.** This is the check that catches the whole overlap
class at its root, rather than at the symptom:

```js
board.nodes
  .filter((n) => n.size)
  .filter(
    (n) =>
      byId.get(n.id).w !== n.size.width || byId.get(n.id).h !== n.size.height,
  );
```

**Test live reload** by writing the board file and waiting for the DOM, with no navigation at all.
That is the app's central workflow — a Claude session running the update skill beside an open
window — and nothing else exercises the watcher, the IPC push, or the store's project keying.

**Read pixels when contrast is the question.** React Flow does not inherit the app theme; it picks
between its own `--xy-*` palettes from the `colorMode` prop. Left unset it stays light under a dark
app and the canvas controls go invisible — a regression nothing but pixels will show you.

```js
await cdp.eval(`const el = document.querySelector(".react-flow__controls-zoomin");
  const s = getComputedStyle(el); return s.color + " on " + s.backgroundColor;`);
// dark: "rgb(248, 248, 248) on rgb(43, 43, 43)"   light: "rgb(21, 23, 28) on rgb(254, 254, 254)"
```

**Screenshot** with `Page.captureScreenshot` when you need to look at the thing rather than measure
it. Layout that is _correct_ and layout that is _readable_ are different questions, and only one of
them has an assertion.

## Traps

- **"Click the empty background" is harder than it looks.** React Flow puts `Controls`
  bottom-left, this app puts its legend top-right and its theme toggle bottom-left. A guessed
  corner lands on a button, and a selection that never cleared looks exactly like a bug in
  `onPaneClick`. Use `emptyPanePoint()`, which scans for a point whose topmost element really is
  `.react-flow__pane`.
- **Never truncate text you are about to search.** A `.slice()` in the harness turns "the panel
  does not show X" into "X was past the cut", and you will go looking for an app bug that is not
  there.
- **Never `scrollIntoView` an element inside the React Flow pane.** Measured in maestro: the
  reported rect moves, `getBoundingClientRect` and `elementFromPoint` agree on the new coordinates,
  and a real click there still does nothing — input hit-testing does not honour a scroll performed
  on the pane's `overflow: hidden` container. `clickElement` therefore never scrolls.
- **A real click and a synthetic one answer different questions.** Whether a pointer can reach a
  resource nested inside two container boxes is exactly what `clickElement` tests and `jsClick`
  assumes. Use `clickElement` on the canvas; `jsClick` is for buttons in a scroll container.
- **Wait for the DOM, not a timer** — except right after `fitView`, which animates. Sample screen
  rects before it settles and every one of them is mid-flight.
- **Check the probe is not passing vacuously.** `18/18` nodes with `0` edges, or an assertion that
  ran over an empty array, is a green run that tested nothing.

## Selector reference

| Thing                  | How to find it                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Canvas node            | `.react-flow__node[data-id="<id>"]` — `style.transform` is its flow-space position          |
| Node's component type  | the `react-flow__node-<type>` class: `container`, `resource`, `external`                    |
| Draggability           | React Flow adds a `draggable` class to any node it considers movable — there should be none |
| Viewport               | `.react-flow__viewport` — `style.transform` is the pan/zoom                                 |
| Detail panel           | `aside`; `aside h2` is the selected node's label, `aside h3` the section headings           |
| Empty-board state      | body text `/No board yet/`, naming `/devops-tools:init-devops-tools`                        |
| Invalid-board state    | body text `/could not be read/`, plus the Zod issue paths                                   |
| Resolved theme         | `document.documentElement.className` — `dark` or `light`, set pre-paint                     |
| React Flow's own theme | `.react-flow` carries the same class, driven by its `colorMode` prop                        |

## Fixtures

Fixture projects live under `~/gits/<throwaway-name>` and nowhere else — never a repo anyone cares
about, and never a directory the OS owns. This app cannot write to a project, which makes the rule
cheaper here than in maestro, but a probe should still never be the reason someone's working tree
changed. `probe.mjs` builds three under `~/gits/devops-tools-probe/`, which is the set worth
having:

- **mapped** — a valid board plus some `.tf`, for the canvas.
- **unmapped** — `.tf` and no board, for the "No board yet" path.
- **broken** — a board with a dangling edge endpoint, for the invalid path.

## Reporting

Report what you measured — the counts, the before and after, the pixel values — and say plainly
when something could not be verified. A screenshot is evidence; an assurance is not.
