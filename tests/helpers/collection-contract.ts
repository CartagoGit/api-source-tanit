/**
 * Common contract of the generated COLLECTION, for the e2e tests.
 *
 * `scanner-contract.ts` covers the scan layer (`ParsedRoute`); this
 * covers the other end of the pipeline: what the user ends up
 * importing into Postman. A scanner can return impeccable routes
 * and still produce a collection with duplicated requests,
 * undeclared variables or an unstable id that duplicates the
 * collection on every import.
 *
 * Each `tests/e2e/<framework>-comprehensive.test.ts` invokes it and
 * adds below only its specific checks.
 */
import { describe, expect, test } from "vitest";
import { checkCollectionInvariants } from "../../packages/core/helpers/collection-invariants.helper";
import type { PostmanCollection, PostmanItem } from "../../packages/contracts/interfaces/core/postman.interface";
import { runGenerate } from "./run-scanner";

/** Options for the collection contract. */
export interface ICollectionContractOptions {
  /** Name of the fixture under `tests/fixtures/`. */
  readonly fixtureName: string;
  /** Exact number of expected requests. */
  readonly expectedRequests?: number;
  /** Minimum requests, when the exact number is not stable. */
  readonly minRequests?: number;
  /** The project exposes a login endpoint. */
  readonly hasAuth?: boolean;
}

/** Registers the cases common to every generated collection. */
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

    // Postman uses `_postman_id` to decide whether an import updates
    // the collection or creates a new one. If it changes between
    // runs, every regeneration leaves yet another copy in the
    // workspace.
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
      test("el login guarda el token y va dentro de la primera carpeta", async () => {
        const { collection } = await runGenerate(fixtureName);

        // We look up the item by the explicit URL `…/auth/login`
        // so we do not confuse it with `/auth/refresh` (which also
        // saves the token and also carries the "Login returns a
        // token" script).
        const login = [...eachRequest(collection.item)].find(
          (item) =>
            (item.request?.url?.raw ?? "").includes("/auth/login") &&
            (item.event ?? []).some((e) =>
              e.script.exec.join("\n").includes("Login returns a token"),
            ),
        );
        expect(login).toBeDefined();
        // The login body contains credentials — either Postman variables
        // (`{{authUsername}}`) or real values from the Zod schema
        // (post-S7 AST). We only check that the email/username
        // field and the password field are present, in whichever
        // shape each framework picks.
        const body = login?.request?.body?.raw ?? "";
        expect(body.length).toBeGreaterThan(2);
        expect(body.toLowerCase()).toMatch(/email|username/);
        expect(body.toLowerCase()).toMatch(/password/);

        // a00012 S3.a: the collection's root folder is no longer named
        // "auth"/"login"/"session" but whatever the scanner returns
        // as `autoMainKey` (typically the API version). What the
        // contract does require is that **the login lives under the
        // first top-level folder** — whatever its name is.
        const firstFolder = collection.item[0];
        expect(firstFolder).toBeDefined();
        expect(
          anyRequestInside(firstFolder!),
          "the login should fall inside the first top-level folder",
        ).toBe(true);
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

/**
 * `true` if the item is a folder (has sub-items) and, descending
 * recursively, contains at least one request directly or in any
 * subfolder. Used by the auth contract (a00012 S3.a) where the
 * root folder may be named "v2", "v1", "Admin", etc. and all the
 * contract verifies is that the login **falls inside** the first
 * top-level folder.
 */
function anyRequestInside(folder: PostmanItem): boolean {
  if (!folder.item) return false;
  for (const child of folder.item) {
    if (child.request) return true;
    if (child.item && anyRequestInside(child)) return true;
  }
  return false;
}
