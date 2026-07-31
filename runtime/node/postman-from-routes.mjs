#!/usr/bin/env node
/**
 * postman-from-routes — alternativa Node CLI puro (sin TS, sin bun).
 *
 * Para proyectos donde solo hay Node/npm:
 *   node runtime/node/postman-from-routes.mjs generate
 *   node runtime/node/postman-from-routes.mjs check
 *   node runtime/node/postman-from-routes.mjs open
 *
 * Implementa un subset del contrato agnóstico:
 *   - Descubre rutas PHP.
 *   - Resuelve FormRequest por convención.
 *   - Genera `build/<proyecto>.postman_collection.json`.
 *   - Abre Postman (mac/win/linux/web).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { platform } from "node:process";

const cwd = process.cwd();
const buildDir = join(cwd, "build");
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });

const cmd = process.argv[2] ?? null;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function parseRoutes(filePrefixes = {}) {
  const routesDir = join(cwd, "routes");
  if (!existsSync(routesDir)) {
    console.error("✘ No se encuentra routes/ en", cwd);
    process.exit(1);
  }
  const files = readdirSync(routesDir).filter((f) => f.endsWith(".php"));
  const out = [];
  for (const f of files) {
    const rel = `routes/${f}`;
    const prefixes = filePrefixes[rel] ?? ["api"];
    const text = stripComments(readFileSync(join(cwd, rel), "utf8"));

    const imports = new Map();
    for (const m of text.matchAll(/use\s+([A-Za-z0-9_\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/g)) {
      const fqcn = m[1];
      const short = fqcn.split("\\").pop();
      const alias = m[2] ?? short;
      imports.set(alias, fqcn);
      if (!imports.has(short)) imports.set(short, fqcn);
    }

    const stack = [...prefixes];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      const pm = line.match(/Route::prefix\(\s*['"]([^'"]+)['"]/);
      if (pm) stack.push(pm[1]);
      if (/\}\s*\)/.test(line) && stack.length > prefixes.length) stack.pop();
      const rm = line.match(/Route::(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/);
      if (rm) {
        const method = rm[1].toUpperCase();
        const rawUri = rm[2];
        const segments = rawUri ? [...stack, rawUri] : [...stack];
        const full = segments.join("/").replace(/\/+/g, "/");
        const window = `${line} ${next}`;
        let controllerClass, actionName;
        const am = window.match(/\[\s*([A-Za-z0-9_]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/);
        if (am) {
          const alias = am[1];
          actionName = am[2];
          controllerClass = imports.get(alias) ?? `App\\Http\\Controllers\\${alias}`;
        }
        const entry = { method, uri: full, rawUri };
        if (controllerClass) entry.controllerClass = controllerClass;
        if (actionName) entry.actionName = actionName;
        out.push(entry);
      }
    }
  }
  return out;
}

function toPostmanUri(laravel) {
  let u = laravel.replace(/^(\/?(api\/)?)/, "");
  u = u.replace(/\{([^}:]+)(?::[^}]+)?\}/g, "{{$1}}");
  if (!u.startsWith("/")) u = "/" + u;
  return u.replace(/\/+/g, "/");
}

function topGroup(uri) {
  let u = uri.replace(/^\/?(api\/)?/, "");
  const segs = u.split("/").filter(Boolean);
  return segs[0] ?? "(raíz)";
}

function pretty(k) {
  return k.split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function inferQuery(method, uri) {
  if (method !== "GET") return [];
  if (/\{\{[^}]+\}\}/.test(uri)) {
    return [{ key: "include", value: "all", description: "Relaciones a incluir" }];
  }
  const last = (uri.split("/").pop() ?? "").toLowerCase();
  if (/alive|auth-test|historial|blacklist|codigos|pdf|csv|excel/.test(last)) {
    return [{ key: "q", value: "ejemplo", description: "Búsqueda libre" }];
  }
  return [
    { key: "pagina", value: "1", description: "Número de página" },
    { key: "items_por_pagina", value: "20", description: "Tamaño de página" },
    { key: "q", value: "ejemplo", description: "Búsqueda libre" },
  ];
}

function inferBody(method, uri) {
  const m = method.toUpperCase();
  if (!["POST", "PUT", "PATCH"].includes(m)) return null;
  const segs = uri.split("/").filter(Boolean);
  const last = (segs[segs.length - 1] ?? "").toLowerCase();
  if (/(cancel|reindex|reactivate|restore|approve|reject|refresh|sincronizar|importar|exportar|ejecutar|force|publish)/.test(last)) {
    return { force: true };
  }
  if (["despersonar", "logout", "desactivar"].includes(last)) return {};
  return { force: false };
}

function inferVariables(specs) {
  const map = new Map();
  map.set("baseUrl", "http://localhost/api");
  map.set("token", "");
  for (const s of specs) {
    for (const m of s.uri.matchAll(/\{\{([^}]+)\}\}/g)) {
      const k = m[1];
      if (!map.has(k)) map.set(k, /(^|_)codigo/i.test(k) ? "COD001" : /email/i.test(k) ? "user@ejemplo.com" : "1");
    }
  }
  return [...map.entries()].map(([key, value]) => ({ key, value, type: "string" }));
}

function loadConfig() {
  const envConfig = process.env.POSTMAN_CONFIG;
  if (envConfig && existsSync(envConfig)) {
    return JSON.parse(readFileSync(envConfig, "utf8"));
  }
  // Buscar examples/*/config.constant.json o config.json
  const fs = require("node:fs");
  const candidates = [
    ...(fs.existsSync(join(cwd, "examples")) ? readdirSync(join(cwd, "examples")) : []).flatMap((d) =>
      ["config.constant.json", "config.json"].map((f) => join(cwd, "examples", d, f)),
    ),
    join(cwd, "config.json"),
  ].filter((p) => existsSync(p));
  if (candidates[0]) return JSON.parse(readFileSync(candidates[0], "utf8"));
  // Mínimo viable
  return {
    name: cwd.split("/").pop(),
    collectionName: `${cwd.split("/").pop()} (Postman)`,
    collectionDescription: "Colección generada por postman-from-routes (Node CLI).",
    variables: [
      { key: "baseUrl", value: "http://localhost/api", type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    filePrefixes: {},
  };
}

function buildCollection(specs, cfg) {
  const groups = new Map();
  for (const s of specs) {
    const key = topGroup(s.uri);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      name: s.name,
      request: {
        method: s.method,
        header: [
          { key: "Accept", value: "application/json", type: "text" },
          { key: "Authorization", value: "Bearer {{token}}", type: "text" },
          ...(s.body ? [{ key: "Content-Type", value: "application/json", type: "text" }] : []),
        ],
        url: {
          raw: "{{baseUrl}}" + s.uri,
          host: ["{{baseUrl}}"],
          path: s.uri.split("/").filter(Boolean),
          ...(s.query ? { query: s.query.map((q) => ({ ...q, disabled: false })) } : {}),
        },
        ...(s.body
          ? { body: { mode: "raw", raw: JSON.stringify(s.body, null, 2), options: { raw: { language: "json" } } } }
          : {}),
        ...(s.description ? { description: s.description } : {}),
      },
    });
  }
  const items = [];
  for (const [k, ch] of groups) items.push({ name: pretty(k), item: ch });
  return {
    info: {
      name: cfg.collectionName ?? cfg.name,
      description: cfg.collectionDescription ?? "",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _postman_id: "00000000-0000-0000-0000-000000000001",
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
    variable: cfg.variables ?? inferVariables(specs),
    item: items,
  };
}

function openPostman(filePath) {
  if (!existsSync(filePath)) {
    console.error("✘ No se encuentra", filePath);
    return 1;
  }
  const os = platform();
  console.log("→ Abriendo Postman con:", filePath);
  if (os === "darwin") {
    spawnSync("open", ["-a", "Postman", filePath], { stdio: "inherit" });
    return 0;
  }
  if (os === "win32") {
    spawnSync("cmd", ["/c", "start", "", filePath], { stdio: "inherit" });
    return 0;
  }
  const r1 = spawnSync("xdg-open", [filePath], { stdio: "inherit" });
  if (r1.status === 0) return 0;
  const r2 = spawnSync("gio", ["open", filePath], { stdio: "inherit" });
  if (r2.status === 0) return 0;
  console.log("→ No hay app de escritorio; abre https://app.postman.com/import y arrastra:", filePath);
  spawnSync("xdg-open", ["https://app.postman.com/import"], { stdio: "inherit" });
  return 0;
}

switch (cmd) {
  case "generate": {
    const cfg = loadConfig();
    const routes = parseRoutes(cfg.filePrefixes ?? {});
    const specs = routes
      .filter((r) => ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(r.method))
      .map((r) => {
        const pmUri = toPostmanUri(r.uri);
        const segs = pmUri.split("/").filter(Boolean).filter((s) => !s.startsWith("{{"));
        const resource = segs[segs.length - 1] ?? "";
        return {
          method: r.method,
          uri: pmUri,
          name: `${r.actionName ?? r.method} ${pretty(resource)}`.trim(),
          query: inferQuery(r.method, pmUri),
          ...(inferBody(r.method, pmUri) !== null ? { body: inferBody(r.method, pmUri) } : {}),
        };
      });
    const coll = buildCollection(specs, cfg);
    const base = process.env.POSTMAN_OUTPUT_BASENAME ?? `${cfg.name}.postman_collection`;
    const out = join(buildDir, `${base}.json`);
    writeFileSync(out, JSON.stringify(coll, null, 2));
    console.log("✔ Colección escrita en", out);
    console.log(`  · ${specs.length} specs`);
    if (process.argv.includes("--open")) openPostman(out);
    break;
  }
  case "check": {
    const cfg = loadConfig();
    const base = process.env.POSTMAN_OUTPUT_BASENAME ?? `${cfg.name}.postman_collection`;
    const path = join(buildDir, `${base}.json`);
    if (!existsSync(path)) {
      console.error("✘ Falta", path, "(ejecuta generate)");
      process.exit(1);
    }
    JSON.parse(readFileSync(path, "utf8"));
    console.log("✔ JSON válido");
    break;
  }
  case "list":
    for (const r of parseRoutes()) {
      console.log(`  ${r.method.padEnd(6)} /${toPostmanUri(r.uri)}`);
    }
    break;
  case "open": {
    const cfg = loadConfig();
    const base = process.env.POSTMAN_OUTPUT_BASENAME ?? `${cfg.name}.postman_collection`;
    openPostman(join(buildDir, `${base}.json`));
    break;
  }
  default:
    console.log("postman-from-routes (Node CLI)");
    console.log("Uso: node postman-from-routes.mjs <generate|check|list|open> [--open]");
}
