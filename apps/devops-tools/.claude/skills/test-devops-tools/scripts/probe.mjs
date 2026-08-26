#!/usr/bin/env node
// The standing probe for the DevOps Tools window.
//
//   pnpm --filter devops-tools build
//   node apps/devops-tools/.claude/skills/test-devops-tools/scripts/probe.mjs
//
// Runs against the PACKAGED build (`electron .` over out/), not `pnpm dev`. main/index.ts calls
// loadURL() when ELECTRON_RENDERER_URL is set and loadFile() otherwise, so dev serves the renderer
// over http and never touches the file:// path that ships. Asset resolution, CSP and code-split
// chunk paths only fail in the packaged load.
//
// Copy it to the scratchpad and edit it for whatever you are actually investigating; keep this one
// asserting the things that must never regress.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containedIn, openProjectAt, overlaps, withApp } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../../..");
// The app's own .bin, not the repo root's: electron is a devDependency of apps/devops-tools, and
// under pnpm that is the only node_modules/.bin it is linked into.
const electron = path.join(appDir, "node_modules/.bin/electron");

// Fixture projects live under ~/gits, never in a repo anyone cares about and never anywhere the
// OS owns. This app cannot write to a project, but the habit is worth keeping: a probe should
// never be the reason someone's working tree changed.
const FIXTURES = path.join(os.homedir(), "gits", "devops-tools-probe");
const BOARD = path.join(".claude", "devops-tools.json");
const validBoard = fs.readFileSync(
  path.join(appDir, "test/fixtures/oli-board.json"),
  "utf8",
);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function fixture(name, files) {
  const root = path.join(FIXTURES, name);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}

const mapped = fixture("mapped", {
  [BOARD]: validBoard,
  "infra/main.tf": 'provider "aws" {}\n',
});
const unmapped = fixture("unmapped", {
  "infra/main.tf": 'provider "aws" {}\n',
});
const brokenBoard = JSON.parse(validBoard);
brokenBoard.edges[0].target = "aws_instance.does_not_exist";
const broken = fixture("broken", {
  [BOARD]: JSON.stringify(brokenBoard, null, 2),
});

const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "devops-tools-probe-profile-"),
);

await withApp(
  { appDir, electron, port: 9333, userDataDir },
  async (cdp, { errors, logs }) => {
    console.log("\n── a mapped project ──");
    await openProjectAt(cdp, mapped);
    await cdp.waitFor(
      `document.querySelectorAll(".react-flow__node").length > 0`,
      { label: "canvas nodes" },
    );
    // fitView animates; sample after it settles or every screen rect is mid-flight.
    await cdp.waitFor(
      `document.querySelector(".react-flow__viewport")?.style.transform?.includes("scale")`,
    );
    await new Promise((r) => setTimeout(r, 600));

    const board = JSON.parse(validBoard);
    const g = await cdp.geometry();
    const byId = new Map(g.nodes.map((n) => [n.id, n]));

    check(
      "every node in the file is on the canvas",
      g.nodes.length === board.nodes.length,
      `${g.nodes.length}/${board.nodes.length}`,
    );
    check(
      "edges rendered",
      g.edges === board.edges.length,
      `${g.edges}/${board.edges.length}`,
    );

    // The read-only promise, at the DOM level. React Flow adds a `draggable` class to any node it
    // considers movable, so this catches a regression the unit test cannot: element-level props
    // winning over the per-node ones, or vice versa.
    check(
      "no node is draggable",
      !g.nodes.some((n) => n.draggable),
      g.nodes
        .filter((n) => n.draggable)
        .map((n) => n.id)
        .join(", "),
    );

    const types = new Map(board.nodes.map((n) => [n.id, n.kind]));
    const wrongType = g.nodes.filter((n) => n.type !== types.get(n.id));
    check(
      "each node rendered with the component its kind names",
      wrongType.length === 0,
      wrongType.map((n) => `${n.id}=${n.type}`).join(", "),
    );

    // The whole point of the nested layout. A child that escaped its container means the board's
    // parent-relative coordinates were read as absolute, which looks like scattered boxes.
    const escaped = board.nodes
      .filter((n) => n.parentId)
      .map((n) => ({ child: byId.get(n.id), parent: byId.get(n.parentId) }))
      .filter(
        ({ child, parent }) =>
          child && parent && !containedIn(child, parent, 2),
      );
    check(
      "every child renders inside its container",
      escaped.length === 0,
      escaped.map((e) => e.child.id).join(", "),
    );

    // Siblings at the same level must not stack. Overlap here means the layout script's arithmetic
    // is wrong, and it is invisible in the JSON.
    const siblings = board.nodes
      .filter((n) => n.parentId === "aws_vpc.main")
      .map((n) => byId.get(n.id))
      .filter(Boolean);
    const stacked = [];
    for (let i = 0; i < siblings.length; i++)
      for (let j = i + 1; j < siblings.length; j++)
        if (
          overlaps(
            {
              x: siblings[i].sx,
              y: siblings[i].sy,
              w: siblings[i].sw,
              h: siblings[i].sh,
            },
            {
              x: siblings[j].sx,
              y: siblings[j].sy,
              w: siblings[j].sw,
              h: siblings[j].sh,
            },
          )
        )
          stacked.push(`${siblings[i].id}/${siblings[j].id}`);
    check(
      "VPC-level siblings do not overlap",
      stacked.length === 0,
      stacked.join(", "),
    );

    // The root cause of that overlap, checked directly: the layout script places siblings on a grid
    // using the size it wrote into the file, so a DOM box even a few pixels wider than that lands on
    // its neighbour while the JSON still validates.
    const mismeasured = board.nodes
      .map((n) => ({ n, dom: byId.get(n.id) }))
      .filter(
        ({ n, dom }) =>
          dom && n.size && (dom.w !== n.size.width || dom.h !== n.size.height),
      );
    check(
      "every node renders at exactly the size the board declares",
      mismeasured.length === 0,
      mismeasured
        .map(
          ({ n, dom }) =>
            `${n.id} ${dom.w}x${dom.h} vs ${n.size.width}x${n.size.height}`,
        )
        .join(", "),
    );

    const clipped = await cdp.eval(`
    return [...document.querySelectorAll(".react-flow__node")]
      .map(n => ({ id: n.getAttribute("data-id"), over: n.firstElementChild ? n.firstElementChild.scrollHeight - n.firstElementChild.clientHeight : 0 }))
      .filter(x => x.over > 1);
  `);
    check(
      "no node clips its own content",
      clipped.length === 0,
      clipped.map((c) => `${c.id} +${c.over}px`).join(", "),
    );

    console.log("\n── selection ──");
    const empty = await cdp.panel();
    check("panel starts empty", !empty.title, empty.empty?.slice(0, 40));

    // A real click, not a synthetic one: the question here is whether a pointer can actually reach a
    // resource that sits inside two nested container boxes, and jsClick would answer a different one.
    await cdp.clickElement(
      `return document.querySelector('.react-flow__node[data-id="aws_security_group.web"]');`,
    );
    await cdp.waitFor(`!!document.querySelector("aside h2")`, {
      label: "panel heading",
    });
    const selected = await cdp.panel();
    check(
      "clicking a nested resource selects it",
      selected.title === "oli-web",
      selected.title,
    );
    check(
      "panel shows the attributes section",
      selected.sections.includes("Attributes"),
      selected.sections.join(" / "),
    );
    check(
      "panel shows the notes from the board",
      selected.text.includes("SSM Session Manager"),
    );
    check(
      "panel links to the source file",
      selected.text.includes("infra/network.tf"),
    );

    // Containers are painted over the whole area their children occupy. If the container were not
    // pointer-events:none except on its header, this click would select the VPC, not the endpoint.
    await cdp.clickElement(
      `return document.querySelector('.react-flow__node[data-id="aws_vpc_endpoint.s3"]');`,
    );
    await cdp.waitFor(
      `document.querySelector("aside h2")?.textContent.includes("s3 gateway")`,
      { label: "endpoint selected" },
    );
    check("a container does not swallow clicks meant for its children", true);

    const bare = await cdp.emptyPanePoint();
    await cdp.click(bare.x, bare.y);
    await new Promise((r) => setTimeout(r, 200));
    check(
      "clicking the pane clears the selection",
      !(await cdp.panel()).title,
      `at ${bare.x},${bare.y}`,
    );

    console.log("\n── theme ──");
    const theme = await cdp.eval(`
    const html = document.documentElement.className;
    const rf = document.querySelector(".react-flow").className;
    const btn = document.querySelector(".react-flow__controls-zoomin");
    const s = getComputedStyle(btn);
    return { html, rf, control: s.color + " on " + s.backgroundColor };
  `);
    // React Flow does not inherit the app's theme — it picks between its own --xy-* palettes from
    // the colorMode prop. Left unset it stays light under a dark app and the controls go invisible.
    const appDark = theme.html.includes("dark");
    check(
      "React Flow's colorMode follows the app theme",
      theme.rf.includes(appDark ? "dark" : "light"),
      `html="${theme.html}" rf="${theme.rf}"`,
    );
    console.log(`    controls: ${theme.control}`);

    console.log("\n── live reload ──");
    // The workflow this app is built around: the user runs the update skill in a Claude session with
    // the window open. Nothing navigates; main watches .claude/ and pushes a fresh read.
    const grown = JSON.parse(validBoard);
    grown.nodes.push({
      id: "aws_instance.web",
      kind: "resource",
      resourceType: "aws_instance",
      service: "ec2",
      label: "web server",
      parentId: 'aws_subnet.this["public-a"]',
      position: { x: 24, y: 34 },
    });
    fs.writeFileSync(path.join(mapped, BOARD), JSON.stringify(grown, null, 2));
    const appeared = await cdp
      .waitFor(
        `!!document.querySelector('.react-flow__node[data-id="aws_instance.web"]')`,
        { timeoutMs: 8000, label: "new node after file write" },
      )
      .then(() => true)
      .catch(() => false);
    check(
      "a board rewritten on disk reaches the canvas with no navigation",
      appeared,
    );
    fs.writeFileSync(path.join(mapped, BOARD), validBoard);

    console.log("\n── a project with no board ──");
    await openProjectAt(cdp, unmapped);
    await cdp.waitFor(`document.body.textContent.includes("No board yet")`, {
      label: "empty state",
    });
    const emptyText = await cdp.eval(
      `return document.body.textContent.replace(/\\s+/g, " ");`,
    );
    check(
      "names the init skill",
      emptyText.includes("/devops-tools:init-devops-tools"),
    );
    check(
      "names the file it is looking for",
      emptyText.includes("devops-tools.json"),
    );
    check(
      "draws no canvas",
      (await cdp.eval(
        `return document.querySelectorAll(".react-flow__node").length;`,
      )) === 0,
    );

    console.log("\n── a board that does not validate ──");
    await openProjectAt(cdp, broken);
    await cdp.waitFor(
      `document.body.textContent.includes("could not be read")`,
      { label: "invalid state" },
    );
    const brokenText = await cdp.eval(
      `return document.body.textContent.replace(/\\s+/g, " ");`,
    );
    check(
      "shows the validation error, with its path",
      brokenText.includes("edges.0.target"),
      brokenText.match(/edges\.\d+\.\w+[^"]{0,60}/)?.[0],
    );
    check(
      "points at the update skill",
      brokenText.includes("/devops-tools:update-devops-tools"),
    );

    console.log("\n── console ──");
    // React Flow's own warnings are noisy but harmless; anything else is a real finding.
    const real = errors.filter((e) => !/React Flow:|Warning:/.test(e));
    check("no console errors", real.length === 0, real.slice(0, 3).join(" | "));

    if (failures) {
      console.log("\nmain process output:");
      for (const [stream, text] of logs.slice(-8))
        process.stdout.write(`  [${stream}] ${text}`);
    }
  },
);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
