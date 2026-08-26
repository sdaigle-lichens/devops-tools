#!/usr/bin/env node
// Computes every position and size in a board, from the graph alone.
//
//   node layout-board.mjs [path]          # rewrites the file in place
//   node layout-board.mjs [path] --stdout # prints instead, changes nothing
//
// The init and update skills emit the GRAPH — nodes, parents, edges — and then run this. Laying
// out by hand in a model's head is arithmetic over dozens of nested boxes, and getting it slightly
// wrong produces a board that validates and looks broken. Doing it here also buys the property
// that makes a committed diagram worth committing: the layout is a pure function of the graph, so
// re-running the update skill against unchanged Terraform produces a byte-identical file and an
// empty `git diff`. A resource moving on the canvas means a resource actually moved.
//
// Node order within a container is the order the skill emitted, so authorial intent survives.
//
// Bare node, no dependencies — this runs inside the user's repository.

import fs from "node:fs";
import path from "node:path";

// Geometry. Every number here is in React Flow units, which are CSS pixels at zoom 1.
//
// EVERY node gets an explicit `size`, leaves included, and the node components render at exactly
// that size. That is not decoration: this script places siblings on a grid using the size it
// assumed, so a node whose DOM box came out wider than assumed overlaps its neighbour on the
// canvas while the JSON looks perfectly correct. Measured — a route table with a long label and a
// summary row rendered 204px wide against an assumed 180 and sat on top of the node beside it.
// Writing the size down is what keeps the two from drifting.
const RESOURCE = { width: 180, height: 60 };
const SUMMARY_ROW = 16; // each summary line the node renders under its title
const MAX_SUMMARY_ROWS = 3; // resource-node.tsx slices to the same number
const EXTERNAL = { width: 168, height: 44 };
const PAD = 24; // container inset on the left, right and bottom
const HEADER = 34; // extra inset at the top, where the container's label sits
const GAP = 24; // between siblings
const MIN_CONTAINER = { width: 220, height: 96 };
const COLUMNS = 3; // leaf resources wrap after this many per row
const ROOT_GAP = 72; // between the global column and the first VPC

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const target = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(".claude", "devops-tools.json"));

let board;
try {
  board = JSON.parse(fs.readFileSync(target, "utf8"));
} catch (err) {
  console.error(`Could not read ${target}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(board.nodes)) {
  console.error(`${target} has no nodes array.`);
  process.exit(1);
}

const childrenOf = new Map();
for (const node of board.nodes) {
  const key = node.parentId ?? null;
  if (!childrenOf.has(key)) childrenOf.set(key, []);
  childrenOf.get(key).push(node);
}

/** Intrinsic size of a leaf, before anything is placed. */
function leafSize(node) {
  if (node.kind === "external") return { ...EXTERNAL };
  const rows = Math.min(MAX_SUMMARY_ROWS, node.summary?.length ?? 0);
  return { width: RESOURCE.width, height: RESOURCE.height + rows * SUMMARY_ROW };
}

/**
 * Place `items` (already sized) in a row or a column, starting at the given origin.
 * Returns the bounding box the run occupies. Mutates each item's `position`.
 */
function run(items, originX, originY, axis) {
  let x = originX;
  let y = originY;
  let width = 0;
  let height = 0;
  for (const { node, size } of items) {
    node.position = { x, y };
    if (axis === "row") {
      width = x + size.width - originX;
      height = Math.max(height, size.height);
      x += size.width + GAP;
    } else {
      width = Math.max(width, size.width);
      height = y + size.height - originY;
      y += size.height + GAP;
    }
  }
  return { width, height };
}

/** Place leaves in a wrapping grid. Returns the bounding box. */
function grid(items, originX, originY) {
  const rowHeight = Math.max(0, ...items.map((i) => i.size.height));
  let width = 0;
  items.forEach(({ node, size }, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    node.position = { x: originX + col * (size.width + GAP), y: originY + row * (rowHeight + GAP) };
    width = Math.max(width, col * (size.width + GAP) + size.width);
  });
  const rows = Math.ceil(items.length / COLUMNS);
  return { width, height: rows === 0 ? 0 : rows * rowHeight + (rows - 1) * GAP };
}

/**
 * Availability zones sit side by side inside their VPC — that is how AWS draws a multi-AZ diagram
 * and how anyone reading one expects to find the second copy of a subnet. Everything else stacks.
 */
function axisFor(parent) {
  return parent && parent.role === "vpc" ? "row" : "column";
}

/**
 * Size and place one node's subtree. Children are positioned relative to this node, which is
 * React Flow's convention and the reason this can be a straight post-order walk: a container's
 * size depends on its children, and its children's coordinates never depend on where it lands.
 */
function measure(node) {
  if (node.kind !== "container") {
    const size = leafSize(node);
    node.size = size;
    return size;
  }

  const children = childrenOf.get(node.id) ?? [];
  const sized = children.map((child) => ({ node: child, size: measure(child) }));
  const containers = sized.filter((c) => c.node.kind === "container");
  const leaves = sized.filter((c) => c.node.kind !== "container");

  const originX = PAD;
  let cursorY = HEADER;
  let innerWidth = 0;
  let innerHeight = 0;

  if (containers.length > 0) {
    const box = run(containers, originX, cursorY, axisFor(node));
    innerWidth = Math.max(innerWidth, box.width);
    innerHeight = box.height;
    cursorY += box.height + GAP;
  }
  if (leaves.length > 0) {
    const box = grid(leaves, originX, cursorY);
    innerWidth = Math.max(innerWidth, box.width);
    innerHeight = cursorY - HEADER + box.height;
  }

  const size = {
    width: Math.max(MIN_CONTAINER.width, innerWidth + PAD * 2),
    height: Math.max(MIN_CONTAINER.height, innerHeight + HEADER + PAD),
  };
  node.size = size;
  return size;
}

// Roots: anything global — S3, CloudFront, an external actor — goes in a column on the left, and
// the VPCs sit to its right. This is the shape of every AWS diagram anyone has ever drawn by hand.
const roots = childrenOf.get(null) ?? [];
const sizedRoots = roots.map((node) => ({ node, size: measure(node) }));
const regional = sizedRoots.filter((r) => r.node.kind === "container" && (r.node.role === "vpc" || r.node.role === "region"));
const global = sizedRoots.filter((r) => !regional.includes(r));

const globalBox = run(global, 0, 0, "column");
run(regional, global.length > 0 ? globalBox.width + ROOT_GAP : 0, 0, "row");

const json = JSON.stringify(board, null, 2) + "\n";
if (toStdout) {
  process.stdout.write(json);
} else {
  fs.writeFileSync(target, json);
  const containerCount = board.nodes.filter((n) => n.kind === "container").length;
  console.log(`✓ laid out ${board.nodes.length} node(s) (${containerCount} container(s)) in ${path.relative(process.cwd(), target) || target}`);
}
