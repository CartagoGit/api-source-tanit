#!/usr/bin/env bun
/**
 * `apisrc init` — bootstraps the host project.
 *
 * Scans a Laravel project and automatically generates:
 *   - `examples/<project>/config.constant.ts`
 *   - `examples/<project>/endpoints.constant.ts` (empty, for overrides)
 *
 * Detects:
 *   - `composer.json` → package name.
 *   - `routes/*.php` → prefixes in use.
 *   - `app/Http/Middleware/` → Sanctum/Passport/JWT.
 *   - `.env` / `.env.example` → APP_URL → baseUrl.
 *   - `app/Providers/RouteServiceProvider.php` → applied prefixes.
 *
 * Usage:
 *   bun run scripts/init.script.ts
 *   bun run scripts/init.script.ts --name my-api
 *   bun run scripts/init.script.ts --output ./examples/my-api
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFileAtomic } from "../../core/helpers/atomic-write.helper.js";
import { join, resolve } from "node:path";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { detectProjectNameIn } from "../../core/discovery/project-name.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import type { IInitOutcome } from "../../contracts/interfaces/cli/init-outcome.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { BASE_PATH_ENV_VAR, DEFAULT_BASE_URL } from "../../contracts/constants/core/base-url.constant.js";

/**
 * Prepares the configuration and returns **what was written**.
 *
 * `main` is the wrapper that only returns the exit code, as in the
 * rest of the commands. They are split apart because the plugin tool
 * needs the paths: they are what an agent has to show so that someone
 * goes and edits the `// TODO`s.
 */
export async function runInit(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IInitOutcome> {
  const root = (context ?? resolveProjectContext({ argv })).projectRoot;

  const nameFlag = readFlag(argv, "--name");
  const outFlag = readFlag(argv, "--output");

  // --- Name detection -------------------------------------------------
  //
  // By `detectProjectNameIn`, which is what the zero-config mode already
  // uses and knows how to read the eleven ecosystems: `package.json`,
  // `go.mod`, `pom.xml`, `Cargo.toml`, `composer.json`…
  //
  // Previously this only looked at **`composer.json`** —a leftover
  // from when the tool was Laravel-only— and if it could not find it,
  // it fell back to the folder name. The result was that the wizard
  // **made the project worse**: on `example-express`, `summary` would
  // say `sample-express` before running it and the directory name
  // after, because the generated config overwrites the good detection.
  const projectName = nameFlag ?? (await detectProjectNameIn(root));

  // --- baseUrl detection ---------------------------------------------
  //
  // The default is the origin (a00012 S4). The `/api` suffix only
  // appears when one of the documented sources supplies it:
  //   1. explicit route (routePrefix matched by a scanner),
  //   2. framework (Laravel/Express/... → router prefix),
  //   3. explicit config (`delendai.config.json#basePath`,
  //      `.tanitrc.json#basePath`),
  //   4. OpenAPI `servers[]`,
  //   5. environment variable `POSTMAN_BASE_PATH`.
  //
  // The two that apply to the wizard are covered here: `APP_URL` (with
  // its suffix as-is) and `POSTMAN_BASE_PATH` (env). The first three
  // correspond to project decisions, not the wizard's.
  let baseUrl: string = DEFAULT_BASE_URL;
  for (const f of [".env", ".env.example"]) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8");
      const m =
        text.match(/^APP_URL\s*=\s*(.+)$/m) ??
        text.match(/^APP_BASE_URL\s*=\s*(.+)$/m);
      if (m?.[1] !== undefined) {
        baseUrl = m[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    } catch {
      /* ignore */
    }
  }
  const envBasePath = process.env[BASE_PATH_ENV_VAR]?.trim();
  if (envBasePath && envBasePath.length > 0) {
    const clean = envBasePath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (clean.length > 0 && !baseUrl.endsWith(`/${clean}`)) {
      baseUrl = `${baseUrl.replace(/\/+$/, "")}/${clean}`;
    }
  }

  // --- Auth middleware detection -------------------------------------
  const authGuards: string[] = [];
  const middlewareDir = join(root, "app/Http/Middleware");
  if (existsSync(middlewareDir)) {
    try {
      const files = listDir(middlewareDir);
      for (const f of files) {
        if (/sanctum/i.test(f)) authGuards.push("sanctum");
        if (/passport/i.test(f)) authGuards.push("passport");
        if (/jwt/i.test(f)) authGuards.push("jwt");
      }
    } catch {
      /* ignore */
    }
  }
  if (authGuards.length === 0) authGuards.push("token");

  // --- Route prefix detection ----------------------------------------
  // Only HTTP/CLI route files with Route::xxx are included (not
  // web.php, console.php, or channels.php, which do not expose API
  // endpoints).
  const filePrefixes: Record<string, string[]> = {};
  const routesDir = join(root, "routes");
  const NON_API_ROUTE_FILES = new Set([
    "web.php",
    "console.php",
    "channels.php",
    "api.php.bak",
  ]);
  if (existsSync(routesDir)) {
    for (const f of listDir(routesDir)) {
      if (!f.endsWith(".php")) continue;
      if (NON_API_ROUTE_FILES.has(f)) continue;
      filePrefixes[`routes/${f}`] = f === "api.php" ? [] : ["api"];
    }
  }

  // --- Generate files ------------------------------------------------
  const dest = outFlag
    ? resolve(outFlag)
    : join(root, "resources/postman/examples", projectName);

  mkdirSync(dest, { recursive: true });

  const configPath = join(dest, "config.constant.ts");
  const configBody = `/**
 * Configuración del proyecto \`${projectName}\` generada por
 * \`apisrc init\`.
 *
 * Edita los valores marcados con \`// TODO\` para personalizarlos.
 */
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";

export const config: ProjectConfig = {
  name: "${projectName}",
  collectionName: "${projectName} (Postman)",  // TODO
  collectionDescription: "Postman collection for ${projectName}.",  // TODO
  baseUrl: "${baseUrl}",

  variables: [
    { key: "baseUrl", value: "${baseUrl}", type: "string" },
    { key: "token", value: "", type: "string" },
    // TODO añade aquí variables propias (slug, codigo, etc.)
  ],

  filePrefixes: ${JSON.stringify(filePrefixes, null, 4)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n")
    .trim()},

  // Agrupación lógica por prefijo de URI (orden de prioridad).
  zones: [
    // TODO: ["login", "Auth"], ["usuarios", "Auth"],
  ],

  zoneOrder: ["Auth", "Recursos", "Comercial", "Operaciones", "Otros"],

  defaultZone: "Otros",

  authDescriptions: {
    // TODO personaliza descripciones por guard (detectado: ${authGuards.join(", ")})
  },

  loginEndpointName: "Login",  // TODO si tu endpoint tiene otro nombre

  uriGroupOverrides: {
    // TODO p. ej. { "tol/tecdoc": "tol/tecdoc" }
  },

  environments: [
    { name: "Local",     color: "#FF6B6B" },
    { name: "Dev",       color: "#4ECDC4" },
    { name: "Staging",   color: "#FFD93D" },
    { name: "Production", color: "#95E1D3" },
  ],
};
`;
  await writeFileAtomic(configPath, configBody);

  const endpointsPath = join(dest, "endpoints.constant.ts");
  const endpointsBody = `/**
 * Overrides manuales opcionales para endpoints del proyecto \`${projectName}\`.
 *
 * Por defecto, el paquete descubre todos los endpoints desde
 * \`routes/*.php\` automáticamente. Solo añade aquí los endpoints
 * que necesites personalizar (body de ejemplo, nombre legible,
 * carpeta explícita).
 *
 * Ejemplo:
 * \`\`\`ts
 * import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
 *
 * export const ALL_ENDPOINTS: EndpointSpec[] = [
 *   {
 *     name: "Login (manual)",
 *     method: "POST",
 *     uri: "/login",
 *     body: { email: "user@ejemplo.com", password: "secret" },
 *   },
 * ];
 * \`\`\`
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

export const ALL_ENDPOINTS: EndpointSpec[] = [
  // TODO añade aquí tus overrides
];
`;
  await writeFileAtomic(endpointsPath, endpointsBody);

  console.log(`✔ Project detected: ${projectName}`);
  console.log(`  · baseUrl:       ${baseUrl}`);
  console.log(`  · auth guards:   ${authGuards.join(", ")}`);
  console.log(`  · routes:        ${Object.keys(filePrefixes).join(", ")}`);
  console.log(`✔ Written:`);
  console.log(`  · ${configPath}`);
  console.log(`  · ${endpointsPath}`);
  console.log("");
  console.log("Next step:");
  // `bun run build` is a script **from this repository**, not from the
  // project of the person using the tool: it does not exist in their
  // terminal. The wizard exists for those who do not know the flags,
  // so ending with a command they cannot run leaves them worse off
  // than before.
  console.log("  apisrc generate   # build the Postman collection");
  return {
    code: 0,
    projectName,
    baseUrl,
    authGuards,
    routeFiles: Object.keys(filePrefixes),
    configPath,
    endpointsPath,
    error: null,
  };
}

/** The wrapper used by the CLI: only the exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runInit(argv)).code;
}

function listDir(p: string): string[] {
  try {
    return readdirSync(p) as string[];
  } catch {
    return [];
  }
}
if (import.meta.main) {
  process.exit(await main());
}