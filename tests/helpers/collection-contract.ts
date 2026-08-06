/**
 * Contrato común de la COLECCIÓN generada, para los e2e.
 *
 * `scanner-contract.ts` cubre la capa de escaneo (`ParsedRoute`); esto
 * cubre el otro extremo del pipeline: lo que el usuario acaba
 * importando en Postman. Un scanner puede devolver rutas impecables y
 * aun así producir una colección con requests duplicadas, variables sin
 * declarar o un id inestable que duplica la colección en cada import.
 *
 * Cada `tests/e2e/<framework>-comprehensive.test.ts` lo invoca y añade
 * debajo solo sus comprobaciones específicas.
 */
import { describe, expect, test } from "vitest";
import { checkCollectionInvariants } from "../../helper/collection-invariants.helper";
import type { PostmanCollection, PostmanItem } from "../../contract/postman.interface";
import { runGenerate } from "./run-scanner";

/** Ajustes del contrato de colección. */
export interface ICollectionContractOptions {
  /** Nombre del fixture bajo `tests/fixtures/`. */
  readonly fixtureName: string;
  /** Número exacto de requests esperadas. */
  readonly expectedRequests?: number;
  /** Mínimo de requests, si el número exacto no es estable. */
  readonly minRequests?: number;
  /** El proyecto expone endpoint de login. */
  readonly hasAuth?: boolean;
}

/** Registra los casos comunes a toda colección generada. */
export function describeCollectionContract(options: ICollectionContractOptions): void {
  const { fixtureName } = options;

  describe(`contrato de colección — ${fixtureName}`, () => {
    test("no incumple ninguna invariante de Postman v2.1.0", async () => {
      const { collection } = await runGenerate(fixtureName);
      expect(checkCollectionInvariants(collection)).toEqual([]);
    });

    test("declara el schema v2.1.0", async () => {
      const { collection } = await runGenerate(fixtureName);
      expect(collection.info.schema).toContain("2.1.0");
    });

    // Postman usa `_postman_id` para decidir si un import actualiza la
    // colección o crea otra. Si cambia entre ejecuciones, cada
    // regeneración deja una copia más en el workspace.
    test("el _postman_id es estable entre generaciones", async () => {
      const first = await runGenerate(fixtureName);
      const second = await runGenerate(fixtureName);
      expect(first.collection.info._postman_id).toBeDefined();
      expect(second.collection.info._postman_id).toBe(first.collection.info._postman_id!);
    });

    test("no hay dos requests con el mismo método y url", async () => {
      const { collection } = await runGenerate(fixtureName);
      const keys = requestKeys(collection);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    });

    test("toda {{variable}} usada está declarada", async () => {
      const { collection } = await runGenerate(fixtureName);
      const declared = new Set(collection.variable.map((v) => v.key));
      const used = new Set<string>();
      for (const item of eachRequest(collection.item)) {
        for (const m of (item.request?.url?.raw ?? "").matchAll(/\{\{([^}$][^}]*)\}\}/g)) {
          used.add((m[1] ?? "").trim());
        }
      }
      const undeclared = [...used].filter((v) => !declared.has(v));
      expect(undeclared).toEqual([]);
    });

    test("no hay carpetas vacías", async () => {
      const { collection } = await runGenerate(fixtureName);
      for (const folder of eachFolder(collection.item)) {
        expect(folder.item!.length).toBeGreaterThan(0);
      }
    });

    test("cada request tiene nombre, método y url", async () => {
      const { collection } = await runGenerate(fixtureName);
      for (const item of eachRequest(collection.item)) {
        expect(item.name.length).toBeGreaterThan(0);
        expect(item.request?.method).toBeTruthy();
        expect(item.request?.url?.raw).toBeTruthy();
      }
    });

    test("todas las urls arrancan en {{baseUrl}}", async () => {
      const { collection } = await runGenerate(fixtureName);
      for (const item of eachRequest(collection.item)) {
        expect(item.request?.url?.raw?.startsWith("{{baseUrl}}")).toBe(true);
      }
    });

    test("la colección declara auth bearer con {{token}}", async () => {
      const { collection } = await runGenerate(fixtureName);
      expect(collection.auth?.type).toBe("bearer");
      expect(collection.auth?.bearer?.[0]?.value).toBe("{{token}}");
    });

    test("las métricas cuadran con los requests emitidos", async () => {
      const { collection, metrics } = await runGenerate(fixtureName);
      expect(requestKeys(collection)).toHaveLength(metrics.specs);
    });

    if (options.expectedRequests !== undefined) {
      test(`emite exactamente ${options.expectedRequests} requests`, async () => {
        const { collection } = await runGenerate(fixtureName);
        expect(requestKeys(collection)).toHaveLength(options.expectedRequests!);
      });
    } else if (options.minRequests !== undefined) {
      test(`emite al menos ${options.minRequests} requests`, async () => {
        const { collection } = await runGenerate(fixtureName);
        expect(requestKeys(collection).length).toBeGreaterThanOrEqual(options.minRequests!);
      });
    }

    if (options.hasAuth) {
      test("el login guarda el token y va en la primera carpeta", async () => {
        const { collection } = await runGenerate(fixtureName);

        const login = [...eachRequest(collection.item)].find((item) =>
          (item.event ?? []).some((e) =>
            e.script.exec.join("\n").includes("Login returns a token"),
          ),
        );
        expect(login).toBeDefined();
        expect(login?.request?.body?.raw ?? "").toContain("{{auth");

        const firstFolder = collection.item[0];
        expect(firstFolder?.name?.toLowerCase()).toMatch(/auth|login|sesi/);
      });
    }
  });
}

function requestKeys(collection: PostmanCollection): string[] {
  return [...eachRequest(collection.item)].map(
    (i) => `${i.request?.method} ${i.request?.url?.raw}`,
  );
}

function* eachRequest(items: ReadonlyArray<PostmanItem>): Generator<PostmanItem> {
  for (const item of items) {
    if (item.item) {
      yield* eachRequest(item.item);
      continue;
    }
    if (item.request) yield item;
  }
}

function* eachFolder(items: ReadonlyArray<PostmanItem>): Generator<PostmanItem> {
  for (const item of items) {
    if (!item.item) continue;
    yield item;
    yield* eachFolder(item.item);
  }
}
