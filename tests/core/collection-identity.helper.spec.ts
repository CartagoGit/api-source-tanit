import { describe, expect, test } from "vitest";
import { collectionIdFor, environmentIdFor, stableUuid } from "../../projects/core/helpers/collection-identity.helper";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("stableUuid", () => {
  test("es determinista: misma semilla, mismo UUID", () => {
    expect(stableUuid("mi-api")).toBe(stableUuid("mi-api"));
  });

  test("semillas distintas dan UUIDs distintos", () => {
    expect(stableUuid("mi-api")).not.toBe(stableUuid("otra-api"));
  });

  test("tiene forma de UUID canónico", () => {
    expect(stableUuid("mi-api")).toMatch(UUID_RE);
  });

  // Postman rechaza IDs que no cumplan RFC 4122.
  test("es un UUID de versión 5", () => {
    expect(stableUuid("mi-api")[14]).toBe("5");
  });

  test("tiene la variante RFC 4122 (10xx en el primer nibble del grupo 4)", () => {
    expect(["8", "9", "a", "b"]).toContain(stableUuid("mi-api")[19]);
  });

  test("normaliza mayúsculas y espacios sobrantes", () => {
    expect(stableUuid("Mi  API")).toBe(stableUuid("mi api"));
    expect(stableUuid("  mi-api  ")).toBe(stableUuid("mi-api"));
  });

  test("normaliza acentos", () => {
    expect(stableUuid("Catálogo")).toBe(stableUuid("catalogo"));
  });

  test("la semilla vacía sigue produciendo un UUID válido", () => {
    expect(stableUuid("")).toMatch(UUID_RE);
  });
});

describe("collectionIdFor", () => {
  test("respeta el id explícito del host", () => {
    expect(collectionIdFor({ explicitId: "fijado-a-mano" })).toBe("fijado-a-mano");
  });

  test("ignora un id explícito vacío o en blanco", () => {
    expect(collectionIdFor({ explicitId: "   ", collectionName: "API" })).toMatch(UUID_RE);
  });

  test("el mismo proyecto da siempre el mismo id", () => {
    const identity = { collectionName: "Mi API", projectName: "mi-api", framework: "express" };
    expect(collectionIdFor(identity)).toBe(collectionIdFor({ ...identity }));
  });

  test("dos proyectos distintos no colisionan", () => {
    expect(collectionIdFor({ collectionName: "API A" })).not.toBe(
      collectionIdFor({ collectionName: "API B" }),
    );
  });

  // Dos equipos con una carpeta llamada `backend/` no deben pisarse.
  test("el framework desempata proyectos con el mismo nombre", () => {
    expect(collectionIdFor({ projectName: "backend", framework: "express" })).not.toBe(
      collectionIdFor({ projectName: "backend", framework: "django" }),
    );
  });

  test("sin ninguna pista devuelve un id fijo, no aleatorio", () => {
    expect(collectionIdFor({})).toBe(collectionIdFor({}));
    expect(collectionIdFor({})).toMatch(UUID_RE);
  });
});

describe("environmentIdFor", () => {
  test("es determinista", () => {
    expect(environmentIdFor("col-1", "Local")).toBe(environmentIdFor("col-1", "Local"));
  });

  test("distingue entornos dentro de la misma colección", () => {
    expect(environmentIdFor("col-1", "Local")).not.toBe(environmentIdFor("col-1", "Prod"));
  });

  test("distingue el mismo entorno entre colecciones distintas", () => {
    expect(environmentIdFor("col-1", "Local")).not.toBe(environmentIdFor("col-2", "Local"));
  });

  test("nunca coincide con el id de su colección", () => {
    const collectionId = stableUuid("mi-api");
    expect(environmentIdFor(collectionId, "Local")).not.toBe(collectionId);
  });

  test("tiene forma de UUID canónico", () => {
    expect(environmentIdFor("col-1", "Local")).toMatch(UUID_RE);
  });
});
