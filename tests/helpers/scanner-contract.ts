/**
 * Contrato común que debe cumplir el scanner de CUALQUIER framework.
 *
 * Las 12 suites por framework tenían un número de tests parecido pero no
 * probaban lo mismo, y eso dejó pasar bugs reales:
 *
 *   - Solo Symfony tenía test de "no duplica endpoints"… y estaba escrito
 *     al revés, asertando que **sí** duplicaba.
 *   - Ningún scanner comprobaba que `sourceFile` fuese relativo al
 *     proyecto, que es exactamente lo que estaba roto en Symfony y hacía
 *     que su provider de validación no encontrase nunca el controlador.
 *   - Ninguno comprobaba que un endpoint comentado no acabase en la
 *     colección.
 *
 * `describeScannerContract` genera esos casos a partir del registry, así
 * que un scanner nuevo los hereda sin escribir nada, y un bug de esta
 * familia falla en los 12 sitios a la vez en lugar de en ninguno.
 *
 * Lo que un framework no soporta se declara en `capabilities`. Declararlo
 * es una decisión visible en el código; omitir el test, no.
 */
import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { FrameworkId, ParsedRoute } from "../../projects/core/contracts/scanner.interface";
import { scannerBundleFor } from "../../projects/frameworks/framework.registry";
import { createTempProject, scanProject } from "./scanner-fixture";

/** Verbos que el pipeline sabe convertir en requests de Postman. */
const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Qué sabe hacer el scanner de este framework. */
export interface IScannerCapabilities {
  /**
   * Tiene `IValidationSpecProvider` que resuelve campos reales.
   * `false` para los que dependan por completo de la inferencia
   * heurística. Hoy los 12 lo cumplen.
   */
  readonly validation?: boolean;
  /** Sus rutas incluyen parámetros de path. */
  readonly pathParams?: boolean;
  /**
   * Un endpoint comentado en el fuente se descarta. `false` para los
   * frameworks cuyas rutas viven en YAML/JSON en lugar de en código.
   */
  readonly stripsComments?: boolean;
  /**
   * Las URIs conservan la barra final. `true` en Django, donde
   * `path("users/", …)` la declara a propósito y `APPEND_SLASH` hace que
   * llamar sin ella provoque un 301 que descarta el body de un POST.
   */
  readonly trailingSlash?: boolean;
}

/** Configuración del contrato para un framework. */
export interface IScannerContractOptions {
  readonly framework: FrameworkId;
  /** Raíz del proyecto de referencia (normalmente el comprehensive). */
  readonly fixtureRoot: string;
  /** Ficheros mínimos que hacen que `detect()` dispare, para el test de comentarios. */
  readonly minimalProject?: Record<string, string>;
  /**
   * Fichero del `minimalProject` donde inyectar el endpoint comentado, y
   * el texto a inyectar. Solo se usa si `capabilities.stripsComments`.
   */
  readonly commentedEndpoint?: { readonly file: string; readonly source: string };
  readonly capabilities?: IScannerCapabilities;
}

/**
 * Registra los casos comunes a todos los scanners.
 *
 * Cada `*-scanner.spec.ts` lo invoca y añade debajo solo lo específico
 * de su framework.
 */
export function describeScannerContract(options: IScannerContractOptions): void {
  const { framework, fixtureRoot } = options;
  const capabilities = options.capabilities ?? {};

  describe(`contrato de scanner — ${framework}`, () => {
    test("está registrado en el scanner registry", () => {
      const bundle = scannerBundleFor(framework);
      expect(bundle).not.toBeNull();
      expect(bundle?.projectScanner.framework).toBe(framework);
      expect(bundle?.routeScanner.framework).toBe(framework);
    });

    test("detect() da confianza > 0 sobre su fixture", async () => {
      const bundle = scannerBundleFor(framework)!;
      expect(await bundle.projectScanner.detect(fixtureRoot)).toBeGreaterThan(0);
    });

    test("detect() da 0 sobre un directorio vacío", async () => {
      const empty = await createTempProject({});
      try {
        const bundle = scannerBundleFor(framework)!;
        expect(await bundle.projectScanner.detect(empty.root)).toBe(0);
      } finally {
        await empty.cleanup();
      }
    });

    test("scan() sobre un directorio vacío devuelve [] sin lanzar", async () => {
      const empty = await createTempProject({});
      try {
        const bundle = scannerBundleFor(framework)!;
        const match = await bundle.projectScanner.resolve(empty.root);
        expect(await bundle.routeScanner.scan(match)).toEqual([]);
      } finally {
        await empty.cleanup();
      }
    });

    test("encuentra al menos una ruta en su fixture", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      expect(routes.length).toBeGreaterThan(0);
    });

    // El bug de Symfony: el mismo endpoint declarado en YAML y con
    // #[Route] salía dos veces en la colección del usuario.
    test("no devuelve endpoints duplicados", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      const keys = routes.map((r) => `${r.method} ${r.uri}`);
      const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
      expect(duplicates).toEqual([]);
    });

    test("todos los métodos son verbos HTTP soportados", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      for (const route of routes) {
        expect(SUPPORTED_METHODS.has(route.method)).toBe(true);
        expect(route.method).toBe(route.method.toUpperCase());
      }
    });

    test("todas las URIs están normalizadas", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      for (const route of routes) {
        expect(route.uri.length).toBeGreaterThan(0);
        expect(route.uri).not.toContain("//");
        // Tres scanners (laravel, nestjs, django) emitían sin barra
        // inicial. El adapter lo tapaba, pero cualquier consumidor
        // directo de `ParsedRoute` veía formatos distintos.
        expect(route.uri.startsWith("/")).toBe(true);
        if (!capabilities.trailingSlash) {
          expect(route.uri.endsWith("/")).toBe(route.uri === "/");
        }
      }
    });

    // Fue el bug de Symfony: `sourceFile` absoluto hacía que el provider
    // construyese `join(projectRoot, sourceFile)` y no encontrase nada.
    test("sourceFile es relativo al proyecto y existe en disco", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      for (const route of routes) {
        if (!route.sourceFile) continue;
        // El scanner de OpenAPI apunta a un punto DENTRO del spec
        // (`openapi.yaml#GET/health`); el fichero es la parte previa al `#`.
        const file = route.sourceFile.split("#")[0]!;
        expect(isAbsolute(file)).toBe(false);
        expect(file).not.toContain("..");
        expect(existsSync(join(fixtureRoot, file))).toBe(true);
      }
    });

    test("lineNumber nunca es negativo", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      for (const route of routes) expect(route.lineNumber).toBeGreaterThanOrEqual(0);
    });

    test("escanear dos veces da el mismo resultado", async () => {
      const first = await scanProject(framework, fixtureRoot);
      const second = await scanProject(framework, fixtureRoot);
      expect(sortedKeys(second.routes)).toEqual(sortedKeys(first.routes));
    });

    if (capabilities.pathParams) {
      test("extrae parámetros de path", async () => {
        const { routes } = await scanProject(framework, fixtureRoot);
        const withParams = routes.filter((r) => /[{:<]/.test(r.uri));
        expect(withParams.length).toBeGreaterThan(0);
      });
    }

    if (capabilities.validation) {
      test("el provider de validación resuelve campos en algún POST", async () => {
        const bundle = scannerBundleFor(framework)!;
        expect(bundle.validationProvider).not.toBeNull();

        const { match, routes } = await scanProject(framework, fixtureRoot);
        const posts = routes.filter((r) => r.method === "POST");
        expect(posts.length).toBeGreaterThan(0);

        let resolved = 0;
        for (const post of posts) {
          const result = await bundle.validationProvider!.resolve(post, match);
          if (result.fields.length > 0) resolved += 1;
          for (const field of result.fields) {
            expect(field.fieldName.length).toBeGreaterThan(0);
            expect(["body", "query", "path", "header", "cookie"]).toContain(field.location);
            expect(typeof field.required).toBe("boolean");
          }
        }
        expect(resolved).toBeGreaterThan(0);
      });
    }

    // Se sacan del `options` ANTES del `test(...)`: el estrechamiento
    // del `if` no sobrevive dentro del callback, porque TypeScript no
    // puede saber que nadie ha reasignado `options` mientras tanto.
    const commentedEndpoint = options.commentedEndpoint;
    const minimalProject = options.minimalProject;

    if (capabilities.stripsComments && minimalProject && commentedEndpoint) {
      test("un endpoint comentado no acaba en la colección", async () => {
        const { file, source } = commentedEndpoint;
        const files = { ...minimalProject };
        files[file] = (files[file] ?? "") + "\n" + source + "\n";

        const project = await createTempProject(files);
        try {
          const { routes } = await scanProject(framework, project.root);
          const uris = routes.map((r) => r.uri).join(" ");
          expect(uris).not.toContain("endpoint-comentado");
        } finally {
          await project.cleanup();
        }
      });
    }
  });
}

function sortedKeys(routes: ReadonlyArray<ParsedRoute>): string[] {
  return routes.map((r) => `${r.method} ${r.uri}`).sort();
}
