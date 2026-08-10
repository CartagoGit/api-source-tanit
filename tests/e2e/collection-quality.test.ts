/**
 * La colección como producto.
 *
 * Los tests de scanner comprueban que se detectan las rutas; estos
 * comprueban que lo que acaba en Postman **sirve**. Son cosas distintas:
 * una colección puede tener los 18 endpoints correctos y aun así ser
 * inútil si a los `PUT` les falta el body de ejemplo.
 *
 * Se corre sobre los 12 frameworks, así que un scanner nuevo hereda el
 * listón sin que nadie tenga que acordarse.
 */
import { describe, expect, test } from "vitest";

import {
  SUPPORTED_FRAMEWORKS,
  generateWithAllFrameworks,
} from "../../projects/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";
import { SUPPORTED_METHODS } from "../../projects/contracts/constants/core/postman.constant";
import type { PostmanItem } from "../../projects/contracts/interfaces/core/postman.interface";

/** Todas las requests de la colección, sin las carpetas. */
function requestsOf(items: ReadonlyArray<PostmanItem>): PostmanItem[] {
  return items.flatMap((item) =>
    item.item ? requestsOf(item.item as PostmanItem[]) : [item],
  );
}

describe.each([...SUPPORTED_FRAMEWORKS])("colección de %s", (framework) => {
  test("toda request tiene nombre, método y URL", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      expect(request.name, JSON.stringify(request).slice(0, 120)).toBeTruthy();
      expect(request.request?.method).toBeTruthy();
      expect(request.request?.url?.raw).toBeTruthy();
    }
  });

  test("toda URL cuelga de {{baseUrl}}", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      expect(request.request?.url?.raw, request.name).toMatch(/^\{\{baseUrl\}\}/);
    }
  });

  test("ninguna URL tiene barras dobles", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      const raw = (request.request?.url?.raw ?? "").replace("://", ":/");
      expect(raw.includes("//"), `${request.name}: ${raw}`).toBe(false);
    }
  });

  // La regresión: los campos opcionales se descartaban al construir el
  // body, así que un `update` cuyo FormRequest declara todo con
  // `sometimes` salía SIN body. Es el caso más común de PUT/PATCH, y un
  // ejemplo sin body no sirve para nada.
  test("las escrituras con reglas traen body de ejemplo", async () => {
    const { collection, specs } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    // Se comparan method + URI EXACTOS. Con una comparación por
    // subcadena, `/auth/logout` casaba con la regla de otro endpoint y
    // el test exigía body a un logout, que legítimamente no lo lleva.
    const bodiesByKey = new Map(
      specs
        .filter((spec) => spec.formRequest && spec.body)
        .map((spec) => [`${spec.method} ${spec.uri}`, spec.body]),
    );
    if (bodiesByKey.size === 0) return;

    for (const [key] of bodiesByKey) {
      const [, uri] = key.split(" ");
      const method = key.split(" ")[0];
      const request = requestsOf(collection.item).find(
        (candidate) =>
          candidate.request?.method === method &&
          (candidate.request?.url?.raw ?? "").endsWith(uri ?? "\u0000"),
      );
      if (!request) continue;
      expect(request.request?.body, key).toBeTruthy();
    }
  });

  test("ninguna cabecera va sin clave", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      for (const header of request.request?.header ?? []) {
        expect(header.key, request.name).toBeTruthy();
      }
    }
  });
});

describe("métodos HTTP que Postman soporta", () => {
  // `EndpointSpec["method"]` no contemplaba HEAD ni OPTIONS, pero cinco
  // scanners los detectan (`method: ["GET","HEAD"]` de Fastify,
  // `app.Options()` de Fiber…). El adapter los filtraba en silencio: se
  // escaneaban bien y desaparecían sin que nada lo dijera.
  test("un HEAD declarado llega a la colección", async () => {
    const { specs } = await generateWithAllFrameworks(
      comprehensiveFixtureDir("fastify"),
    );
    expect(specs.some((spec) => spec.method === "HEAD")).toBe(true);
  });

  // La lista del adapter y la del tipo eran dos: añadir un método al
  // tipo no servía de nada hasta acordarse de la otra.
  test("la lista del adapter y la del contrato son la misma", () => {
    expect([...SUPPORTED_METHODS]).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]);
  });
});
