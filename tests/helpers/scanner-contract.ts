/**
 * Common contract that ANY framework's scanner must satisfy.
 *
 * The 12 per-framework suites had a similar number of tests but did
 * not test the same thing, and that let real bugs through:
 *
 *   - Only Sym had a "no duplicated endpoints" test… and it was
 *     written the wrong way, asserting that it **did** duplicate.
 *   - No scanner checked that `sourceFile` was relative to the
 *     project, which is exactly what was broken in Spring and
 *     meant its validation provider never found the controller.
 *   - None checked that a commented endpoint did not end up in
 *     the collection.
 *
 * `describeScannerContract` generates those cases from the registry,
 * so a new scanner inherits them without writing anything, and a
 * bug of this family fails in all 12 places at once instead of
 * in none.
 *
 * What a framework does not support is declared in `capabilities`.
 * Declaring it is a decision visible in the code; skipping the
 * test, it is not.
 */
import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { FrameworkId, ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";
import { scannerBundleFor } from "../../packages/frameworks/framework.registry";
import { createTempProject, scanProject } from "./scanner-fixture";

/** Verbs the pipeline knows how to turn into Postman requests. */
const SUPPORTED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
]);

/** What this framework's scanner can do. */
export interface IScannerCapabilities {
  /**
   * Has an `IValidationSpecProvider` that resolves real fields.
   * `false` for those relying entirely on heuristic inference.
   * All 12 satisfy it today.
   */
  readonly validation?: boolean;
  /** Its routes include path parameters. */
  readonly pathParams?: boolean;
  /**
   * A commented-out endpoint in source is discarded. `false` for
   * frameworks whose routes live in YAML/JSON rather than code.
   */
  readonly stripsComments?: boolean;
  /**
   * URIs keep the trailing slash. `true` in Django, where
   * `path("users/", …)` declares it on purpose and `APPEND_SLASH`
   * makes calling without it trigger a 301 that drops the body
   * of a POST.
   */
  readonly trailingSlash?: boolean;
}

/** Contract configuration for a framework. */
export interface IScannerContractOptions {
  readonly framework: FrameworkId;
  /** Root of the reference project (usually the comprehensive one). */
  readonly fixtureRoot: string;
  /** Minimum files that make `detect()` fire, for the comments test. */
  readonly minimalProject?: Record<string, string>;
  /**
   * File inside the `minimalProject` where to inject the commented
   * endpoint, and the text to inject. Only used if
   * `capabilities.stripsComments`.
   */
  readonly commentedEndpoint?: { readonly file: string; readonly source: string };
  readonly capabilities?: IScannerCapabilities;
}

/**
 * Registers the cases common to all scanners.
 *
 * Each `*-scanner.spec.ts` invokes it and adds below only what is
 * specific to its framework.
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
      const result = await bundle.projectScanner.detect(fixtureRoot);
      expect(result.score).toBeGreaterThan(0);
    });

    test("detect() da 0 sobre un directorio vacío", async () => {
      const empty = await createTempProject({});
      try {
        const bundle = scannerBundleFor(framework)!;
        const result = await bundle.projectScanner.detect(empty.root);
        expect(result.score).toBe(0);
      } finally {
        await empty.cleanup();
      }
    });

    test("scan() sobre un directorio vacío devuelve [] sin lanzar", async () => {
      const empty = await createTempProject({});
      try {
        const bundle = scannerBundleFor(framework)!;
        const match = await bundle.projectScanner.resolve(empty.root);
        expect((await bundle.routeScanner.scan(match)).routes).toEqual([]);
      } finally {
        await empty.cleanup();
      }
    });

    test("encuentra al menos una ruta en su fixture", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      expect(routes.length).toBeGreaterThan(0);
    });

    // The Symfony bug: the same endpoint declared in YAML and with
    // #[Route] came out twice in the user's collection.
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
        // Three scanners (laravel, nestjs, django) emitted without the
        // leading slash. The adapter patched it, but any direct
        // consumer of `ParsedRoute` saw different shapes.
        expect(route.uri.startsWith("/")).toBe(true);
        if (!capabilities.trailingSlash) {
          expect(route.uri.endsWith("/")).toBe(route.uri === "/");
        }
      }
    });

    // It was the Spring bug: an absolute `sourceFile` made the
    // provider build `join(projectRoot, sourceFile)` and find
    // nothing.
    test("sourceFile es relativo al proyecto y existe en disco", async () => {
      const { routes } = await scanProject(framework, fixtureRoot);
      for (const route of routes) {
        if (!route.sourceFile) continue;
        // The OpenAPI scanner points to a spot INSIDE the spec
        // (`openapi.yaml#GET/health`); the file is the part before
        // the `#`.
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

        const { match, result, routes } = await scanProject(framework, fixtureRoot);
        const posts = routes.filter((r) => r.method === "POST");
        expect(posts.length).toBeGreaterThan(0);

        let resolved = 0;
        for (const post of posts) {
          // The contract requires `scanResult` as the third argument even
          // though most providers do not use it. It is the path that
          // avoids mutable state in the scanners (a00010 S2).
          const validation = await bundle.validationProvider!.resolve(
            post,
            match,
            result,
          );
          if (validation.fields.length > 0) resolved += 1;
          for (const field of validation.fields) {
            expect(field.fieldName.length).toBeGreaterThan(0);
            expect(["body", "query", "path", "header", "cookie"]).toContain(field.location);
            expect(typeof field.required).toBe("boolean");
          }
        }
        expect(resolved).toBeGreaterThan(0);
      });
    }

    // Pulled out of `options` BEFORE the `test(...)`: the narrowing
    // of the `if` does not survive inside the callback, because
    // TypeScript cannot know that nobody reassigned `options` in
    // the meantime.
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
