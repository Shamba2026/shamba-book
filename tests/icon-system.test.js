import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

const requiredSymbols = [
  "icon-cow",
  "icon-home",
  "icon-milk",
  "icon-calendar",
  "icon-health",
  "icon-weight",
  "icon-breeding",
  "icon-finance",
  "icon-feed"
];

for (const id of requiredSymbols) {
  assert.match(html, new RegExp(`<symbol\\s+id=["']${id}["']`), `missing SVG symbol ${id}`);
  assert.match(html, new RegExp(`<use\\s+href=["']#${id}["']`), `unused SVG symbol ${id}`);
}

const operationalSections = [
  html.match(/<header class="header">[\s\S]*?<\/header>/)?.[0] ?? "",
  html.match(/<div class="grid two home-overview">[\s\S]*?<\/section>/)?.[0] ?? "",
  html.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)?.[0] ?? ""
].join("\n");

assert.doesNotMatch(
  operationalSections,
  /[🐄🥛📅🩺⚖💰🌿]/u,
  "operational navigation and actions must use the local SVG icon system instead of emoji"
);

assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="brand-icon"/);
assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="nav-icon"/);

console.log("icon-system.test.js: PASS");
