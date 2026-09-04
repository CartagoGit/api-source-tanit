#!/usr/bin/env bun
/**
 * `apisrc init` — bootstrap del proyecto host.
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
import { join, resolve } from "node:path";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { detectProjectNameIn } from "../../core/discovery/project-name.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import type { IInitOutcome } from "../../contracts/interfaces/cli/init-outcome.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { BASE_PATH_ENV_VAR, DEFAULT_BASE_URL } from "../../contracts/constants/core/base-url.constant.js";

/**
 * Prepara la configuración y devuelve **qué ha escrito**.
 *
 * `main` es la envoltura que solo devuelve el código de salida, igual
 * que en el resto de comandos. Se separa porque el tool del plugin
 * necesita las rutas: son lo que un agente tiene que enseñar para que
 * alguien vaya a editar los `// TODO`.
 */
export async function runInit(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IInitOutcome> {
  const root = (context ?? resolveProjectContext({ argv })).projectRoot;

  const nameFlag = readFlag(argv, "--name");
  const outFlag = readFlag(argv, "--output");

  // --- Detección del nombre -----------------------------------------
  //
  // Por `detectProjectNameIn`, que es lo que ya usa el modo zero-config
  // y sabe leer los once ecosistemas: `package.json`, `go.mod`,
  // `pom.xml`, `Cargo.toml`, `composer.json`…
  //
  // Antes esto miraba **solo `composer.json`** —herencia de cuando la
  // herramienta era de Laravel— y si no lo encontraba se quedaba con el
  // nombre de la carpeta. El resultado es que el asistente **empeoraba**
  // el proyecto: sobre `example-express`, `summary` decía
  // `sample-express` antes de ejecutarlo y el nombre del directorio
  // después, porque la config generada pisa la detección buena.
  const projectName = nameFlag ?? (await detectProjectNameIn(root));

  // --- Detección de baseUrl -----------------------------------------
  //
  // El default es el origen (a00012 S4). El sufijo `/api` solo aparece
  // cuando una de las fuentes documentadas lo aporta:
  //   1. ruta explícita (routePrefix matcheado por un scanner),
  //   2. framework (Laravel/Express/... → prefix del router),
  //   3. config explícito (`delendai.config.json#basePath`,
  //      `.tanitrc.json#basePath`),
  //   4. OpenAPI `servers[]`,
  //   5. variable de entorno `POSTMAN_BASE_PATH`.
  //
  // Aquí se cubren las dos que aplican al asistente: `APP_URL` (con su
  // sufijo tal cual) y `POSTMAN_BASE_PATH` (env). Las tres primeras
  // corresponden a decisiones del proyecto, no del asistente.
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
 * \`apisrc init\`.
 *
 * Edita los valores marcados con \`// TODO\` para personalizarlos.
 */
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";

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
  // `bun run build` es un script **de este repositorio**, no del
  // proyecto de quien usa la herramienta: en su terminal no existe. El
  // asistente está para quien no se sabe los flags, así que terminar
  // con un comando que no puede ejecutar es dejarlo peor que antes.
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

/** La envoltura que usa el CLI: solo el código de salida. */
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