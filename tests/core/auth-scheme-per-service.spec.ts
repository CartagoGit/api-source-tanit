/**
 * a00013 S4 — per-service auth + baseUrl.
 *
 * Cubre las cuatro garantías que el contrato del slice promete:
 *
 *  1. `pickAuth` resuelve el override del descriptor o el fallback
 *     del proyecto, **sin colapsar el discriminante**.
 *  2. `toIEndpointAuth` mapea exhaustivamente las cuatro variantes
 *     de `IDetectedAuthScheme.type` (inversa de
 *     `authSchemeFromEndpointAuth` en el pipeline).
 *  3. `buildServiceConfig` aplica el `service.baseUrl` per-service
 *     sin mutar la `ProjectConfig` original. Eso es lo que mantiene
 *     estable `discovery.config.baseUrl` entre iteraciones del loop
 *     multi-service en `buildFor`.
 *  4. El pipeline no muta `discovery.config.baseUrl` en una
 *     generación multi-service — verificable de extremo a extremo
 *     llamando a `generateCollections` sobre un monorepo sintético.
 *
 * Los tests 1-3 son unitarios sobre el helper puro. El 4 es de
 * integración y reproduce el invariante de aceptación #3 del slice.
 */
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildServiceConfig,
  pickAuth,
  toIEndpointAuth,
} from "../../packages/core/discovery/auth-scheme.helper";
import type { IEndpointAuth } from "../../packages/contracts/interfaces/core/postman.interface";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";
import type { IServiceDescriptor } from "../../packages/contracts/interfaces/core/service-graph.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

/** Construye un IServiceDescriptor mínimo para tests unitarios. */
function descriptor(
  serviceId: string,
  auth: IEndpointAuth | undefined = undefined,
  baseUrl: string | null = null,
): IServiceDescriptor {
  const match: IProjectMatch = {
    framework: "express",
    projectRoot: "/repo",
    frameworkSearchRoot: serviceId,
    artifacts: [],
  };
  return {
    serviceId,
    match,
    endpoints: [],
    baseUrl,
    auth,
    variables: [],
  };
}

/** ProjectConfig mínima para tests de `buildServiceConfig`. */
function configFixture(baseUrl = "http://localhost"): ProjectConfig {
  return {
    name: "test",
    collectionName: "Test (Postman)",
    collectionDescription: "Test",
    baseUrl,
    variables: [
      { key: "baseUrl", value: baseUrl, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    filePrefixes: {},
    zones: [],
    zoneOrder: [],
    defaultZone: "Otros",
    authDescriptions: {},
    loginEndpointName: "Login",
  };
}

describe("pickAuth", () => {
  it("devuelve el auth del descriptor cuando está definido", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "bearer" });
    expect(pickAuth(service, undefined)).toEqual({
      kind: "scheme",
      scheme: "bearer",
    });
  });

  it("devuelve el fallback cuando service.auth es undefined", () => {
    const service = descriptor("a", undefined);
    const fallback: IEndpointAuth = { kind: "scheme", scheme: "apiKey" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("devuelve undefined cuando ambos argumentos son undefined", () => {
    const service = descriptor("a", undefined);
    expect(pickAuth(service, undefined)).toBeUndefined();
  });

  it("NO colapsa { kind: 'scheme', scheme: 'bearer' } a { kind: 'none' }", () => {
    // Audit 2ª revisión #16: la primera auditoría del 2026-09-04
    // documentó que el discriminante se podía colapsar por
    // conversión descuidada. pickAuth NO convierte nada: devuelve
    // el mismo objeto que recibió. La garantía la lleva el contrato
    // por construcción.
    const service = descriptor(
      "a",
      { kind: "scheme", scheme: "bearer" } as const,
    );
    const fallback: IEndpointAuth = { kind: "none" };
    const result = pickAuth(service, fallback);
    expect(result).toEqual({ kind: "scheme", scheme: "bearer" });
    expect(result).not.toEqual({ kind: "none" });
  });

  it("preserva { kind: 'scheme', scheme: 'apiKey' } cuando service.auth lo trae", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "apiKey" });
    const fallback: IEndpointAuth = { kind: "none" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("preserva { kind: 'scheme', scheme: 'oauth2' } cuando service.auth lo trae", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "oauth2" });
    const fallback: IEndpointAuth = { kind: "none" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "oauth2",
    });
  });

  it("preserva { kind: 'none' } cuando service.auth lo trae explícitamente", () => {
    // Caso inverso al colapso: el descriptor dice "este servicio es
    // público aunque el resto del proyecto lleve bearer". pickAuth
    // devuelve esa voluntad sin transformarla.
    const service = descriptor("a", { kind: "none" });
    const fallback: IEndpointAuth = { kind: "scheme", scheme: "bearer" };
    expect(pickAuth(service, fallback)).toEqual({ kind: "none" });
  });

  it("es determinista y no produce I/O (puro)", () => {
    // 1000 invocaciones idénticas deben ser idénticas. No medimos
    // tiempo: solo el determinismo. Si pickAuth leyera algo externo,
    // dos llamadas seguidas con el mismo input podrían diferir.
    const service = descriptor("a", { kind: "scheme", scheme: "bearer" });
    const first = pickAuth(service, { kind: "none" });
    for (let i = 0; i < 1000; i++) {
      const again = pickAuth(service, { kind: "none" });
      expect(again).toEqual(first);
    }
  });

  it("el discriminante es exhaustivo: apiKey NO se confunde con bearer ni oauth2", () => {
    const cases: ReadonlyArray<IEndpointAuth> = [
      { kind: "none" },
      { kind: "scheme", scheme: "bearer" },
      { kind: "scheme", scheme: "apiKey" },
      { kind: "scheme", scheme: "oauth2" },
    ];
    for (const auth of cases) {
      const service = descriptor("a", auth);
      const result = pickAuth(service, { kind: "none" });
      expect(result).toEqual(auth);
      // round-trip del discriminante: el `kind` exacto se preserva.
      expect(result?.kind).toBe(auth.kind);
      if (result?.kind === "scheme" && auth.kind === "scheme") {
        expect(result.scheme).toBe(auth.scheme);
      }
    }
  });
});

describe("toIEndpointAuth", () => {
  it("mapea bearer a { kind: 'scheme', scheme: 'bearer' }", () => {
    expect(toIEndpointAuth({ type: "bearer", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "bearer",
    });
  });

  it("mapea apikey a { kind: 'scheme', scheme: 'apiKey' }", () => {
    expect(toIEndpointAuth({ type: "apikey", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("mapea oauth2 a { kind: 'scheme', scheme: 'oauth2' }", () => {
    expect(toIEndpointAuth({ type: "oauth2", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "oauth2",
    });
  });

  it("mapea none a { kind: 'none' }", () => {
    expect(toIEndpointAuth({ type: "none", evidence: "" })).toEqual({
      kind: "none",
    });
  });
});

describe("buildServiceConfig", () => {
  it("aplica service.baseUrl cuando está definido y no es null", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "http://localhost:3001");
    const result = buildServiceConfig(config, service);
    expect(result.baseUrl).toBe("http://localhost:3001");
  });

  it("cae al baseUrl del proyecto cuando service.baseUrl es null", () => {
    const config = configFixture("http://localhost:5555");
    const service = descriptor("a", undefined, null);
    const result = buildServiceConfig(config, service);
    expect(result.baseUrl).toBe("http://localhost:5555");
  });

  it("actualiza la variable {{baseUrl}} cuando hay un override per-service", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "https://staging.example.com");
    const result = buildServiceConfig(config, service);
    const baseUrlVar = result.variables.find((v) => v.key === "baseUrl");
    expect(baseUrlVar?.value).toBe("https://staging.example.com");
  });

  it("NO muta la ProjectConfig original", () => {
    // Aceptación #3 del slice: `buildForService` no debe mutar
    // `config.baseUrl` entre iteraciones del loop multi-service.
    // Aquí se prueba el primitive que lo garantiza: `buildServiceConfig`
    // devuelve una copia y deja el original intacto.
    const config = configFixture("http://localhost");
    const originalBaseUrl = config.baseUrl;
    const originalVarValue = config.variables.find(
      (v) => v.key === "baseUrl",
    )?.value;
    const originalVariablesRef = config.variables;

    const service = descriptor("a", undefined, "http://override:9999");
    const result = buildServiceConfig(config, service);

    expect(config.baseUrl).toBe(originalBaseUrl);
    expect(config.variables.find((v) => v.key === "baseUrl")?.value).toBe(
      originalVarValue,
    );
    // El array `variables` del original es el mismo array: no se
    // muta, y `buildServiceConfig` devuelve uno nuevo.
    expect(result.variables).not.toBe(originalVariablesRef);
    expect(config.variables).toBe(originalVariablesRef);
  });

  it("preserva el resto de variables (token, etc.) sin tocarlas", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "http://override:9999");
    const result = buildServiceConfig(config, service);
    const token = result.variables.find((v) => v.key === "token");
    expect(token).toEqual({ key: "token", value: "", type: "string" });
  });
});

// ───────────────────────────────────────────────────────────────────
// Integración: el invariante "no cross-iteration mutation" del slice.
// ───────────────────────────────────────────────────────────────────

/** Mini filesystem para un proyecto de un servicio. */
async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
}

let work = "";
let projects: ITempProject[] = [];
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "a00013-s4-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("generateCollections (multi-service): config.baseUrl no se muta entre iteraciones", () => {
  test("monorepo express+nest con dos servicios: cada colección usa su propio descriptor", async () => {
    const projectRoot = join(work, "monorepo-express-nest");
    await writeFiles(projectRoot, {
      "package.json": JSON.stringify({
        name: "monorepo-s4",
        private: true,
        workspaces: ["apps/*"],
      }),
      "apps/api/package.json": JSON.stringify({
        name: "@s4/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
      "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("alpha")
export class AppController {
  @Get() list() { return []; }
}
`,
      "apps/web/package.json": JSON.stringify({
        name: "@s4/web",
        dependencies: { express: "^4.19.0" },
      }),
      "apps/web/server.js": `import express from "express";
const app = express();
app.get("/beta", (_req, res) => res.json([]));
app.listen(3000);
`,
    });

    // S4: con dos servicios detectados y combineServices=false, el
    // pipeline emite dos colecciones separadas. Cada `result.config`
    // sale de `buildServiceConfig(discovery.config, service)`.
    const results = await generateCollections(projectRoot, {
      orchestrator: defaultOrchestrator(),
      combineServices: false,
    });

    // Esperamos al menos una colección con endpoints detectados. Si
    // el comando no detecta ninguno (p. ej. fallo de un scanner de
    // ambiente CI), queremos fallar explícitamente — no dar un "ok"
    // que enmascare una regresión silenciosa.
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Cada resultado lleva su propio `config` per-service. Ambos
    // deben ser objetos distintos (cada iteración construyó su
    // copia), aunque nazcan del mismo `discovery.config`.
    const configs = results.map((r) => r.config);
    const baseUrls = configs.map((c) => c.baseUrl);

    // El invariant de aceptación #3: en multi-service, después de
    // `generateCollections`, el `config.baseUrl` debe ser estable
    // *entre iteraciones*. Comprobamos que todas las iteraciones
    // vieron el mismo `baseUrl` (el del proyecto, porque hoy no hay
    // auto-población de `service.baseUrl`). Si `buildForService`
    // mutara `discovery.config.baseUrl` en una iteración, las
    // siguientes empezarían con ese valor mutado — y `baseUrls`
    // reflejaría la cadena de mutaciones, no un valor estable.
    const first = baseUrls[0];
    for (const url of baseUrls) {
      expect(url).toBe(first);
    }

    // Cada `result.config` es un objeto independiente (no la misma
    // referencia). Verifica que `buildServiceConfig` no devuelve
    // `discovery.config` pelado: sería un bug de "comparten memoria"
    // que podría contaminar la siguiente iteración vía `variables`
    // compartida.
    for (let i = 0; i < configs.length; i++) {
      for (let j = i + 1; j < configs.length; j++) {
        expect(configs[i]).not.toBe(configs[j]);
      }
    }

    // El array `variables` de cada config es su propia copia — no
    // la misma referencia compartida con `discovery.config`. Si lo
    // fuera, `inferCollectionVariables` o las adiciones de
    // `authVariablesFor` se filtrarían entre servicios.
    const resultsVars = results.map((r) =>
      r.collection.variable ?? [],
    );
    if (resultsVars.length >= 2) {
      expect(resultsVars[0]).not.toBe(resultsVars[1]);
    }
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────
// x00028 — multi-service spec isolation.
//
// Bug original: `buildForService` consumía `discovery.specs` (el
// catálogo global fusionado por el merger). En un monorepo con dos
// servicios que exponen `GET /health` cada uno (típico: liveness
// probes, ingress controllers, sidecar patterns), ambos servicios
// veían ambos endpoints en su colección.
//
// Después del fix: `filterSpecsForService(discovery.specs, service)`
// recorta el catálogo a los specs cuyo `(method, uri)` está en
// `service.endpoints`. Cada servicio ve solo lo suyo. Este test
// reproduce el escenario y verifica el invariante: dos servicios
// con `GET /health` cada uno producen dos colecciones, cada una con
// su propio `GET /health` apuntado al `baseUrl` correcto.
// ───────────────────────────────────────────────────────────────────

describe("x00028 — multi-service spec isolation", () => {
  test("dos servicios con mismo GET /health: cada colección ve solo su propio /health", async () => {
    // Express + NestJS in two workspaces of the same monorepo, each
    // exposing `GET /health` (liveness) plus one service-specific
    // route. Without the fix, both collections would contain
    // *both* /health requests and *both* /users + /orders. With
    // the fix, each collection contains only its own slice.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-x00028",
          private: true,
          workspaces: ["apps/*"],
        }),
        // apps/api (NestJS) — has its own /health and /widgets.
        "apps/api/package.json": JSON.stringify({
          name: "@x28/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts":
          'import { Controller, Get } from "@nestjs/common";\n' +
          '@Controller("api")\n' +
          "export class AppController {\n" +
          '  @Get("health") health() { return { ok: true }; }\n' +
          '  @Get("widgets") list() { return []; }\n' +
          "}\n",
        // apps/web (Express) — has its own /health and /pages.
        "apps/web/package.json": JSON.stringify({
          name: "@x28/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js":
          'import express from "express";\n' +
          "const app = express();\n" +
          'app.get("/health", (_req, res) => res.json({ ok: true }));\n' +
          'app.get("/pages", (_req, res) => res.json([]));\n' +
          "app.listen(3000);\n",
      },
      "postman-fixture-x00028-",
    );
    projects.push(project);

    const results = await generateCollections(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: false,
    });

    // Two services detected → two collections. If detection collapses
    // them into one, the test fails loudly instead of producing a
    // false positive on the spec-isolation assertion below.
    expect(results.length).toBe(2);

    // Each service should have at most ONE /health request — its own.
    // Before the fix, both services saw both /healths (the bug).
    const allItems = results.flatMap((r) => r.collection.item);
    const healthItems = allItems.filter((item) =>
      item.name?.toLowerCase().includes("health") === true ||
      item.request.url.path.join("/").toLowerCase().includes("health"),
    );
    expect(healthItems).toHaveLength(2);

    // Each /health belongs to a different collection — verify the
    // collections are distinct objects (no shared array reference
    // between services).
    const healthCollections = healthItems.map((item) =>
      results.findIndex((r) => r.collection.item.includes(item)),
    );
    expect(new Set(healthCollections).size).toBe(2);

    // Widgets and pages must NOT cross services. `widgets` belongs
    // only to apps/api; `pages` only to apps/web. Before the fix,
    // both collections would have included both.
    const allItemNames = allItems.map((item) => item.name).sort();
    expect(allItemNames.filter((n) => n?.includes("widgets"))).toHaveLength(1);
    expect(allItemNames.filter((n) => n?.includes("pages"))).toHaveLength(1);
  }, 30_000);
});
