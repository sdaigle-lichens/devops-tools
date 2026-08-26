// Guards on the process boundary, and on the read-only promise.
//
// Both are properties of configuration rather than of code that would fail loudly if it
// regressed. Flipping `nodeIntegration` to true, adding a generic `invoke(channel, ...)` to the
// preload bridge, or dropping an `fs.writeFileSync` into a handler would all work perfectly and
// silently undo something this app claims about itself. Hence these assertions.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, IPC_EVENTS } from "../src/shared/ipc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), "utf8");

/**
 * Drop comments before scanning.
 *
 * Prose talks about imports: a comment naming the very module a check exists to forbid matches an
 * import pattern exactly as well as a real import line does — and the files here are heavily
 * commented precisely about what they are not allowed to do. Line comments only for `//`, so a
 * `"https://"` inside a string survives.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every .ts/.tsx under a src subtree, excluding generated files. */
function sourcesUnder(rel: string): string[] {
  const root = path.join(appRoot, rel);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== "routeTree.gen.ts")
        out.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

describe("BrowserWindow security flags", () => {
  const main = read("src/main/index.ts");

  it("disables node integration in the renderer", () => {
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });

  it("keeps context isolation on", () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
  });

  it("routes external links to the OS browser instead of opening app frames", () => {
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toMatch(/action:\s*"deny"/);
  });
});

describe("preload bridge", () => {
  const preload = stripComments(read("src/preload/index.ts"));

  it("exposes exactly one namespace", () => {
    const exposures = preload.match(/exposeInMainWorld\(/g) ?? [];
    expect(exposures).toHaveLength(1);
    expect(preload).toContain('exposeInMainWorld("devopsTools"');
  });

  // A passthrough would make every other guard here decorative: the renderer could reach any
  // channel main happens to have registered, declared in the contract or not.
  it("offers no generic invoke escape hatch", () => {
    expect(preload).not.toMatch(/invoke\(\s*channel/);
    expect(preload).not.toMatch(/\.\.\.args/);
  });

  it("only invokes channels declared in the shared contract", () => {
    const declared = new Set<string>([
      ...Object.values(IPC),
      ...Object.values(IPC_EVENTS),
    ]);
    // Both the `IPC.foo` form used by invoke and any bare string literal that looks like a
    // channel — `namespace:name` — so a hand-written channel cannot slip in beside the map.
    const literals = preload.match(/"[a-z]+:[a-zA-Z]+"/g) ?? [];
    for (const literal of literals) {
      expect(declared, `undeclared channel ${literal}`).toContain(
        literal.slice(1, -1),
      );
    }
  });

  it("imports nothing but electron and the shared contract", () => {
    const imports = [...preload.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const specifier of imports) {
      expect(
        ["electron", "../shared/ipc.js"],
        `preload imports ${specifier}`,
      ).toContain(specifier);
    }
  });
});

describe("the renderer's reach", () => {
  const rendererSources = sourcesUnder("src/renderer/src");

  it("has files to check", () => {
    expect(rendererSources.length).toBeGreaterThan(5);
  });

  it("imports no node builtins", () => {
    for (const file of rendererSources) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      expect(
        src,
        `${path.relative(appRoot, file)} imports a node builtin`,
      ).not.toMatch(/from\s+"node:/);
    }
  });

  it("never imports electron directly", () => {
    for (const file of rendererSources) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      expect(
        src,
        `${path.relative(appRoot, file)} imports electron`,
      ).not.toMatch(/from\s+"electron"/);
    }
  });

  // The type-level half of this lives in tsconfig.web.json, which names the same three files.
  // Kept in step by hand; this is the check that fails on the import rather than the type.
  it("reaches src/core only through the renderer-safe modules", () => {
    const RENDERER_SAFE = ["board-schema", "board-to-flow", "aws-visuals"];
    for (const file of rendererSources) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      for (const [, specifier] of src.matchAll(
        /from\s+"([^"]*\/core\/[^"]+)"/g,
      )) {
        const module = path.basename(specifier).replace(/\.(ts|js)$/, "");
        expect(
          RENDERER_SAFE,
          `${path.relative(appRoot, file)} imports core/${module}`,
        ).toContain(module);
      }
    }
  });
});

describe("the read-only promise", () => {
  // The whole premise of this app: it visualizes infrastructure and cannot change it. Nothing
  // stops a future handler from writing a board back "just to save the layout", and nothing would
  // fail if it did — so the boundary is asserted rather than trusted.
  // Qualified with `fs.` on purpose. An unqualified word list flags `open(` in a click handler
  // and `rm` in a variable name, and a guard that cries wolf gets deleted. The companion check
  // below is what makes the prefix trustworthy: node:fs may only be imported as a default import,
  // so there is no destructured `writeFileSync` that could slip past this.
  const WRITE_CALLS =
    /\bfs\.(writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync|createWriteStream|truncate|truncateSync|chmod|chmodSync|open|openSync)\s*\(/;

  // project-store owns the app's OWN state, in the app's OWN userData directory. It is the sole
  // exception, and it never touches a path inside a user's repository.
  const ALLOWED = ["src/main/project-store.ts"];

  const appSources = () => [
    ...sourcesUnder("src/main"),
    ...sourcesUnder("src/core"),
    ...sourcesUnder("src/renderer/src"),
  ];

  it("imports node:fs only as a default import, so every call carries the fs. prefix", () => {
    for (const file of appSources()) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      for (const [line] of src.matchAll(/^.*from\s+"node:fs".*$/gm)) {
        expect(
          line,
          `${path.relative(appRoot, file)} destructures node:fs`,
        ).toMatch(/^import\s+\w+\s+from/);
      }
    }
  });

  it("writes to disk from exactly one module", () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      const rel = path.relative(appRoot, file).split(path.sep).join("/");
      if (ALLOWED.includes(rel)) continue;
      if (WRITE_CALLS.test(stripComments(fs.readFileSync(file, "utf8"))))
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the one module that does write inside the app's own userData directory", () => {
    const store = stripComments(read("src/main/project-store.ts"));
    expect(store).toContain('app.getPath("userData")');
    // Every write in that file resolves its target through stateFile(); a write naming any other
    // path would be a write to somewhere this app has no business writing.
    const writeLines = store
      .split("\n")
      .filter((line) => WRITE_CALLS.test(line));
    expect(writeLines.length).toBeGreaterThan(0);
    for (const line of writeLines) {
      expect(line.trim(), "write to a path other than stateFile()").toContain(
        "stateFile()",
      );
    }
  });

  it("makes no network request from anywhere in the app", () => {
    for (const file of [
      ...sourcesUnder("src/main"),
      ...sourcesUnder("src/core"),
      ...sourcesUnder("src/renderer/src"),
    ]) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      expect(
        src,
        `${path.relative(appRoot, file)} makes a network call`,
      ).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
    }
  });
});

describe("the built bundles", () => {
  const outMain = path.join(appRoot, "out/main/index.js");

  it.runIf(fs.existsSync(outMain))(
    "import electron rather than inlining its path shim",
    () => {
      const bundle = fs.readFileSync(outMain, "utf8");
      expect(bundle).toMatch(/(require\("electron"\)|from\s*"electron")/);
      // The shim's body. Inlined, it resolves path.txt beside the bundle, finds nothing, and throws
      // "Electron failed to install correctly" — which sends you off to reinstall node_modules for
      // what is purely a bundling mistake.
      expect(bundle).not.toContain("getElectronPath");
    },
  );
});
