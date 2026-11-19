#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { fromRoot } from "../helpers/root.helper.js";

const source = fromRoot("assets", "icons", "tanit.svg");
const destination = fromRoot("packages", "ui", "web", "tanit-brand.generated.ts");

const svg = await readFile(source);
const url = `data:image/svg+xml;base64,${svg.toString("base64")}`;
const content = `// Generated from assets/icons/tanit.svg by bun run gen:brand.\nexport const TANIT_LOGO_URL = ${JSON.stringify(url)};\n`;

if (process.argv.includes("--check")) {
  if (await readFile(destination, "utf8") !== content) {
    console.error("Run bun run gen:brand to update the embedded Tanit logo.");
    process.exit(1);
  }
} else {
  await writeFile(destination, content);
}
