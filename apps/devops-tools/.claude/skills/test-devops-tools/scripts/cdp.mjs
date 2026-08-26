// A minimal Chrome DevTools Protocol client for driving the DevOps Tools desktop app.
//
// No dependency, by design: Node 22's global WebSocket speaks the protocol, and adding a
// puppeteer-class dependency to this repo just to click a node would be a poor trade. Everything
// here is the small subset that testing a read-only nested canvas actually needs.
//
// Adapted from the same harness in ~/gits/maestro. What is missing relative to that one is
// deliberate: there is no `dragNode`, no `setInputValue`, no `typeText`, because this app has no
// editable state to drive. If a probe here ever needs to drag a node, the probe is wrong.
//
// Usage: see ./probe.mjs, and ../SKILL.md for the recipes.

import { spawn } from "node:child_process";

/**
 * Launch the app under an isolated profile with a debugging port open.
 *
 * `appDir` must be the app root (the dir holding package.json + out/), NOT out/main/index.js —
 * electron resolves the entry from package.json `main`.
 */
export function launch({
  appDir,
  electron,
  port,
  userDataDir,
  extraArgs = [],
  env,
}) {
  const child = spawn(
    electron,
    [
      appDir,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    },
  );
  // Kept so a failing probe can print what the main process said. Electron is chatty on stderr
  // even in a healthy run, so this is diagnostic output, not a failure signal.
  const logs = [];
  child.stdout.on("data", (d) => logs.push(["out", d.toString()]));
  child.stderr.on("data", (d) => logs.push(["err", d.toString()]));
  return { child, logs };
}

/** Poll the debugging endpoint until the renderer's page target exists. */
export async function waitForTarget(port, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "never responded";
  while (Date.now() < deadline) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl,
      );
      if (page) return page;
      lastErr = `no page target among ${targets.length}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for a page target on ${port}: ${lastErr}`);
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  /**
   * Evaluate an async function body in the page and return its JSON value.
   *
   * The body is wrapped in `(async () => { ... })()`, so write `return ...` — and `await` works,
   * which is what makes `window.devopsTools.*` reachable from a probe.
   */
  async eval(body) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        "page threw: " +
          (r.exceptionDetails.exception?.description ??
            JSON.stringify(r.exceptionDetails)),
      );
    }
    return r.result.value;
  }

  /** Poll an expression until it is truthy. Returns its value. Always prefer this to a sleep. */
  async waitFor(expr, { timeoutMs = 15000, label = expr } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.eval(`return (${expr});`);
      if (last) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `waitFor timed out: ${label} (last=${JSON.stringify(last)})`,
    );
  }

  /** Collect console errors and uncaught exceptions for the life of the session. */
  watchErrors() {
    const errors = [];
    this.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error")
        errors.push(p.args.map((a) => a.value ?? a.description).join(" "));
    });
    this.on("Runtime.exceptionThrown", (p) =>
      errors.push(
        "EXCEPTION: " +
          (p.exceptionDetails?.exception?.description ??
            JSON.stringify(p.exceptionDetails)),
      ),
    );
    return errors;
  }

  // ── Input ────────────────────────────────────────────────────────────────

  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      buttons: 0,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
      buttons: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
      buttons: 0,
    });
  }

  /**
   * Real click at the centre of whatever `selectorFn` returns (a JS body returning an Element).
   *
   * Verifies the element is on screen and topmost, and throws loudly if not — a real click into
   * empty space does nothing at all, and without this check the probe fails much later, timing out
   * on something that was never coming.
   *
   * **Never scroll an element inside the React Flow pane into view.** Measured in maestro: the
   * reported rect moves, `getBoundingClientRect` and `elementFromPoint` both agree on the new
   * coordinates, and a real mouse click there still does nothing — input hit-testing does not
   * honour a scroll performed on the pane's `overflow: hidden` container. For an off-screen button
   * in an ordinary scroll container (the detail panel), use `jsClick`.
   */
  async clickElement(selectorFn, { dx = 0, dy = 0 } = {}) {
    const box = await this.eval(`
      const el = (() => { ${selectorFn} })();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2 + ${dx}, y = r.y + r.height / 2 + ${dy};
      const top = document.elementFromPoint(x, y);
      return {
        x, y,
        inViewport: r.y >= 0 && r.y + r.height <= window.innerHeight && r.x >= 0 && r.x + r.width <= window.innerWidth,
        hit: !!top && (top === el || el.contains(top)),
        topEl: top ? top.tagName + "." + String(top.className).slice(0, 60) : null,
      };
    `);
    if (!box) throw new Error("clickElement: selector matched nothing");
    if (!box.inViewport || !box.hit) {
      throw new Error(
        `clickElement: target is not clickable at (${Math.round(box.x)}, ${Math.round(box.y)}) — ` +
          `inViewport=${box.inViewport}, topElement=${box.topEl}. It is off screen or covered.`,
      );
    }
    await this.click(Math.round(box.x), Math.round(box.y));
    return box;
  }

  /**
   * Synthetic `.click()` on the first match of a JS selector body. Correct for plain buttons,
   * and it works regardless of scroll position or occlusion — but it proves nothing about whether
   * a real pointer could have reached the element, which on this canvas is often the question.
   */
  async jsClick(selectorFn) {
    const ok = await this.eval(`
      const el = (() => { ${selectorFn} })();
      if (!el) return false;
      el.click();
      return true;
    `);
    if (!ok) throw new Error("jsClick: selector matched nothing");
    return ok;
  }

  // ── Measurement ──────────────────────────────────────────────────────────

  /** Canvas geometry: node positions in flow space, screen rects, and the viewport transform. */
  geometry() {
    return this.eval(`
      const parse = t => {
        const m = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(t || "");
        return m ? { x: +m[1], y: +m[2] } : null;
      };
      const c = document.querySelector(".react-flow");
      if (!c) return null;
      const cr = c.getBoundingClientRect();
      return {
        cont: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
        vt: document.querySelector(".react-flow__viewport")?.style.transform ?? null,
        edges: document.querySelectorAll(".react-flow__edge").length,
        nodes: [...document.querySelectorAll(".react-flow__node")].map(n => {
          const p = parse(n.style.transform);
          const r = n.getBoundingClientRect();
          return {
            id: n.getAttribute("data-id"),
            // React Flow stamps the registered node type as a class: react-flow__node-container.
            type: (String(n.className).match(/react-flow__node-(\\w+)/) || [])[1] ?? null,
            x: p?.x, y: p?.y, w: n.offsetWidth, h: n.offsetHeight,
            sx: r.x, sy: r.y, sw: r.width, sh: r.height,
            draggable: n.className.includes("draggable"),
          };
        }),
      };
    `);
  }

  /**
   * A point on the canvas that is bare pane — nothing on it, and not covered by the controls,
   * the legend or the theme toggle.
   *
   * Worth a scan rather than a guessed corner: React Flow puts `Controls` bottom-left, this app
   * puts its legend top-right and its theme toggle bottom-left, and a "click the empty background"
   * that lands on the zoom button looks exactly like a selection that refused to clear.
   */
  async emptyPanePoint() {
    const p = await this.eval(`
      const c = document.querySelector(".react-flow");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      for (let fy = 0.1; fy <= 0.9; fy += 0.1) {
        for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
          const x = r.x + r.width * fx, y = r.y + r.height * fy;
          const el = document.elementFromPoint(x, y);
          if (el && el.classList.contains("react-flow__pane")) return { x: Math.round(x), y: Math.round(y) };
        }
      }
      return null;
    `);
    if (!p)
      throw new Error(
        "emptyPanePoint: every sampled point was covered by a node or an overlay",
      );
    return p;
  }

  /**
   * What the detail panel is currently showing: its heading, resource type, and the node id line.
   * Null when nothing is selected.
   */
  panel() {
    return this.eval(`
      const aside = document.querySelector("aside");
      if (!aside) return null;
      const h2 = aside.querySelector("h2");
      if (!h2) return { empty: aside.textContent.trim() };
      return {
        title: h2.textContent.trim(),
        sections: [...aside.querySelectorAll("h3")].map(h => h.textContent.trim()),
        // NOT truncated. A slice here silently turns "the panel does not show X" into "X was past
        // the cut", and the probe reports an app bug that is really a harness bug.
        text: aside.textContent.replace(/\\s+/g, " ").trim(),
      };
    `);
  }
}

/** Axis-aligned overlap test, for asserting a layout does not stack nodes. */
export function overlaps(a, b) {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Is `inner`'s screen rect fully inside `outer`'s, within a pixel of slack? */
export function containedIn(inner, outer, slack = 1) {
  return (
    inner.sx >= outer.sx - slack &&
    inner.sy >= outer.sy - slack &&
    inner.sx + inner.sw <= outer.sx + outer.sw + slack &&
    inner.sy + inner.sh <= outer.sy + outer.sh + slack
  );
}

/**
 * Open a project and land on the board, without the native folder dialog.
 *
 * `window.devopsTools.project.open` is on the preload bridge. Routing is HASH history (a packaged
 * build loads over file://), so navigation is a hash write — and the root is a search param the
 * main process re-validates against the projects it knows, which is why the `open` call above has
 * to come first.
 */
export async function openProjectAt(cdp, projectRoot) {
  await cdp.eval(
    `return await window.devopsTools.project.open(${JSON.stringify(projectRoot)});`,
  );
  await cdp.eval(
    `window.location.hash = "#/board?root=" + encodeURIComponent(${JSON.stringify(projectRoot)}); return true;`,
  );
}

/** Run `fn` against a freshly launched window, always tearing the process down afterwards. */
export async function withApp({ appDir, electron, port, userDataDir }, fn) {
  const { child, logs } = await launch({ appDir, electron, port, userDataDir });
  try {
    const target = await waitForTarget(port);
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const errors = cdp.watchErrors();
    await cdp.waitFor(`document.readyState === "complete"`);
    return await fn(cdp, { errors, logs });
  } finally {
    child.kill("SIGTERM");
    // Give the port time to free up before the next launch in the same run.
    await new Promise((r) => setTimeout(r, 700));
  }
}
