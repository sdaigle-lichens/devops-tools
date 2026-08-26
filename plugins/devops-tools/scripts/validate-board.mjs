#!/usr/bin/env node
// Checks a devops-tools.json against the exact schema the desktop app enforces.
//
//   node validate-board.mjs [path]     # defaults to .claude/devops-tools.json
//
// The init and update skills run this immediately after writing, so a board that the app would
// refuse to open is caught in the session that produced it, while the model still has the
// Terraform in context and can fix it. Exits 0 on success, 1 on any problem.
//
// Runs under bare `node` inside the user's repository: no dependencies, no install, nothing from
// the devops-tools workspace. scripts/lib/board-schema.cjs is generated from the app's own
// src/core/board-schema.ts and carries its copy of zod inlined, which is what makes that possible.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = path.join(".claude", "devops-tools.json");
const target = path.resolve(process.argv[2] ?? DEFAULT_PATH);

function fail(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

let parseBoard;
try {
  ({ parseBoard } = require(path.join(here, "lib", "board-schema.cjs")));
} catch (err) {
  fail(
    `Could not load the board schema: ${err.message}`,
    "This file is generated — run `pnpm --filter devops-tools build:plugin-libs` in the devops-tools repo.",
  );
}

let raw;
try {
  raw = fs.readFileSync(target, "utf8");
} catch (err) {
  fail(err.code === "ENOENT" ? `No board at ${target}` : `Could not read ${target}: ${err.message}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${target} is not valid JSON:`, `  ${err.message}`);
}

const result = parseBoard(data);
if (!result.ok) {
  fail(`${target} does not match the board schema:`, ...result.errors.map((e) => `  ${e}`));
}

const { board } = result;
const containers = board.nodes.filter((n) => n.kind === "container").length;
const resources = board.nodes.filter((n) => n.kind === "resource").length;
const external = board.nodes.filter((n) => n.kind === "external").length;

console.log(`✓ ${path.relative(process.cwd(), target) || target} is valid`);
console.log(`  ${containers} container(s), ${resources} resource(s), ${external} external, ${board.edges.length} edge(s)`);
console.log(`  ${board.folded?.length ?? 0} folded resource(s)`);
