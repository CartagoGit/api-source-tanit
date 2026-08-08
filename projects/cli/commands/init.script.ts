#!/usr/bin/env bun
/**
 * `export-to-postman init` — bootstrap del proyecto host.
 *
 * Escanea un proyecto Laravel y genera automáticamente:
 *   - `examples/<proyecto>/config.constant.ts`
 *   - `examples/<proyecto>/endpoints.constant.ts` (vacío, para overrides)
 *
 * Detecta:
 *   - `composer.json` → nombre del paquete.
 *   - `routes/*.php` → prefijos usados.
 *   - `app/Http/Middleware/` → Sanctum/Passport/JWT.
 *   - `.env` / `.env.example` → APP_URL → baseUrl.
 *   - `app/Providers/RouteServiceProvider.php` → prefijos aplicados.
 *
 * Uso:
 *   bun run scripts/init.script.ts
 *   bun run scripts/init.script.ts --name mi-api
 *   bun run scripts/init.script.ts --output ./examples/mi-api
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFileAtomic } from "../../core/helpers/atomic-write.helper.js";
import { dirname, join, resolve } from "node:path";
import { projectRoot } from "../../core/discovery/paths.service.js";

function flag(name: string, argv: string[]): string | null {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = projectRoot();
  if (!root) {
    console.error(
      "✘ No se detecta proyecto Laravel. Define POSTMAN_PROJECT_ROOT.",
    );
    return 1;
  }

  const nameFlag = flag("--name", argv);
  const outFlag = flag("--output", argv);

  // --- Detección del nombre -----------------------------------------
  let projectName = nameFlag ?? "";
  try {
    const composer = JSON.parse(
      readFileSync(join(root, "composer.json"), "utf8"),
    ) as { name?: string };
    if (!projectName && composer.name) {
      const parts = composer.name.split("/");
      projectName = parts[parts.length - 1] ?? "";
    }
  } catch {
    // composer.json ausente o malformado
  }
  if (!projectName) {
    projectName = basename(root);
  }

  // --- Detección de baseUrl -----------------------------------------
  let baseUrl = "http://localhost/api";
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
        if (!/\/api\/?$/.test(baseUrl)) baseUrl += "/api";
        break;
      }
    } catch {
      /* ignore */
    }
  }

  // --- Detección de middleware de auth -------------------------------
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

  // --- Detección de prefijos de rutas --------------------------------
  // Solo incluimos archivos de rutas HTTP/CLI con Route::xxx (no web.php,
  // console.php ni channels.php, que no exponen endpoints API).
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

  // --- Genera archivos ------------------------------------------------
  const dest = outFlag
    ? resolve(outFlag)
    : join(root, "resources/postman/examples", projectName);

  mkdirSync(dest, { recursive: true });

  const configPath = join(dest, "config.constant.ts");
  const configBody = `/**
 * Configuración del proyecto \`${projectName}\` generada por
 * \`export-to-postman init\`.
 *
 * Edita los valores marcados con \`// TODO\` para personalizarlos.
 */
import type { ProjectConfig } from "../../../../contracts/project-config.interface.js";

export const config: ProjectConfig = {
  name: "${projectName}",
  collectionName: "${projectName} (Postman)",  // TODO
  collectionDescription: "Colección Postman de ${projectName}.",  // TODO
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
 * import type { EndpointSpec } from "../../../../contracts/postman.interface.js";
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
import type { EndpointSpec } from "../../../../contracts/postman.interface.js";

export const ALL_ENDPOINTS: EndpointSpec[] = [
  // TODO añade aquí tus overrides
];
`;
  await writeFileAtomic(endpointsPath, endpointsBody);

  console.log(`✔ Proyecto detectado: ${projectName}`);
  console.log(`  · baseUrl:       ${baseUrl}`);
  console.log(`  · auth guards:   ${authGuards.join(", ")}`);
  console.log(`  · routes:        ${Object.keys(filePrefixes).join(", ")}`);
  console.log(`✔ Generado:`);
  console.log(`  · ${configPath}`);
  console.log(`  · ${endpointsPath}`);
  console.log("");
  console.log("Siguiente paso:");
  console.log("  bun run build  # genera la colección Postman");
  return 0;
}

function basename(p: string): string {
  const m = p.split(/[/\\]/).filter(Boolean);
  return m[m.length - 1] ?? "";
}

function listDir(p: string): string[] {
  try {
    return readdirSync(p) as string[];
  } catch {
    return [];
  }
}

void dirname; // reserved for future use
void join;
process.exit(await main());