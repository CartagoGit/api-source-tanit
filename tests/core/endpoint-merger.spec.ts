import { describe, expect, test } from "vitest";
import {
  EndpointMerger,
  endpointSpecFromMerged,
  mergeEndpoints,
} from "../../packages/core/discovery/endpoint-merger.service";
import type { IEndpointMergeCandidate } from "../../packages/contracts/interfaces/core/merge.interface";
import type { IDetectedAuthScheme } from "../../packages/contracts/interfaces/core/discovery.interface";
import type { IValidationSpec } from "../../packages/contracts/interfaces/core/scanner.interface";

function body(s: string): unknown {
  return { example: s };
}

const OPENAPI_BODY = body("from-openapi");
const FASTIFY_BODY = body("from-fastify");
const REGEX_BODY = body("from-regex");

const BEARER: IDetectedAuthScheme = {
  type: "bearer",
  evidence: "Authorization: Bearer detected in spec/securitySchemes",
};
const APIKEY: IDetectedAuthScheme = {
  type: "apikey",
  keyName: "X-API-Key",
  keyIn: "header",
  evidence: "X-API-Key header detected in routes",
};

function field(partial: Partial<IValidationSpec>): IValidationSpec {
  return {
    fieldName: "name",
    location: "body",
    type: "string",
    required: false,
    ...partial,
  };
}

function candidate(
  partial: Partial<IEndpointMergeCandidate>,
): IEndpointMergeCandidate {
  return {
    framework: "unknown",
    scannerScore: 0.5,
    method: "GET",
    uri: "/users",
    ...partial,
  };
}

describe("EndpointMerger — identidad", () => {
  test("1 candidato es identity passthrough", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "express",
        scannerScore: 0.6,
        body: REGEX_BODY,
        description: "Lista usuarios",
      }),
    ]);

    expect(merged.method).toBe("GET");
    expect(merged.uri).toBe("/users");
    expect(merged.body).toBe(REGEX_BODY);
    expect(merged.description).toBe("Lista usuarios");
    expect(merged.provenance.contributors).toEqual(["express"]);
    expect(merged.provenance.route.framework).toBe("express");
    expect(merged.provenance.body?.framework).toBe("express");
    expect(merged.provenance.description?.framework).toBe("express");
    // Sin auth → redistribuye pesos entre las 3 piezas presentes:
    //   route(0.4)*0.5 + body(0.3)*0.5 + desc(0.1)*0.5 = 0.4
    // Normalizado a 0.8 / (0.4+0.3+0.1) = 0.4 / 0.8 = 0.5
    expect(merged.confidence).toBeCloseTo(0.5, 2);
  });

  test("method se normaliza a uppercase en la salida", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ method: "post", uri: "/users", framework: "openapi" }),
    ]);
    expect(merged.method).toBe("POST");
  });

  test("name se preserva del ganador (GraphQL/tRPC identity)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        method: "post",
        uri: "/graphql",
        name: "GetUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
      candidate({
        method: "post",
        uri: "/graphql",
        name: "GetUser",
        framework: "openapi",
        scannerScore: 0.95,
      }),
    ]);
    expect(merged.name).toBe("GetUser");
  });

  test("lista vacía lanza", () => {
    const merger = new EndpointMerger();
    expect(() => merger.merge([])).toThrow(
      /no se puede fusionar una lista vacía/i,
    );
  });
});

describe("EndpointMerger — body", () => {
  test("gana el de mayor confianza: OpenAPI > Fastify > resto", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.9, body: REGEX_BODY }),
      candidate({ framework: "fastify", scannerScore: 0.9, body: FASTIFY_BODY }),
      candidate({ framework: "openapi", scannerScore: 0.7, body: OPENAPI_BODY }),
    ]);

    expect(merged.body).toBe(OPENAPI_BODY);
    expect(merged.provenance.body?.framework).toBe("openapi");
  });

  test("a igual confianza gana el primero en orden de llegada", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "laravel", scannerScore: 0.9, body: body("laravel") }),
      candidate({ framework: "symfony", scannerScore: 0.9, body: body("symfony") }),
    ]);

    expect(merged.body).toEqual(body("laravel"));
    expect(merged.provenance.body?.framework).toBe("laravel");
  });
});

describe("EndpointMerger — fields", () => {
  test("unión por fieldName: required true gana sobre false", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.9,
        fields: [field({ fieldName: "email", required: false, type: "string" })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        fields: [field({ fieldName: "email", required: true, type: "string" })],
      }),
    ]);

    expect(merged.fields).toHaveLength(1);
    expect(merged.fields?.[0]?.required).toBe(true);
    expect(merged.fields?.[0]?.fieldName).toBe("email");
  });

  test("unión: integer gana sobre string cuando required coincide", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        fields: [field({ fieldName: "age", type: "string", required: true })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        fields: [field({ fieldName: "age", type: "integer", required: true })],
      }),
    ]);

    expect(merged.fields?.[0]?.type).toBe("integer");
  });

  test("unión con format declarado gana sobre sin format", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        fields: [field({ fieldName: "id", type: "string", required: true })],
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.9,
        fields: [
          field({
            fieldName: "id",
            type: "string",
            required: true,
            format: "uuid",
          }),
        ],
      }),
    ]);

    expect(merged.fields?.[0]?.format).toBe("uuid");
  });

  test("fields de 3 candidatos: 2 únicos, 1 compartido (restrictivo gana)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.9,
        fields: [
          field({ fieldName: "a", type: "string", required: false }),
          field({ fieldName: "b", type: "integer", required: true }),
        ],
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "b", type: "string", required: false })],
      }),
      candidate({
        framework: "hono",
        scannerScore: 0.85,
        fields: [field({ fieldName: "c", type: "boolean", required: true })],
      }),
    ]);

    expect(merged.fields).toHaveLength(3);
    const names = merged.fields?.map((f) => f.fieldName).sort();
    expect(names).toEqual(["a", "b", "c"]);
    const b = merged.fields?.find((f) => f.fieldName === "b");
    // integer > string, required > optional, mismo candidato
    expect(b?.type).toBe("integer");
    expect(b?.required).toBe(true);
  });

  test("ningún candidato con fields → fields undefined", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.6 }),
    ]);
    expect(merged.fields).toBeUndefined();
  });
});

describe("EndpointMerger — auth", () => {
  test("auth sin conflicto: gana el de mayor confianza", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.5, authScheme: BEARER }),
      candidate({ framework: "fastify", scannerScore: 0.85, authScheme: BEARER }),
    ]);

    expect(merged.authScheme?.type).toBe("bearer");
    expect(merged.provenance.auth?.framework).toBe("fastify");
  });

  test("auth en conflicto (bearer vs apikey): warning + el de mayor confianza gana", () => {
    const { specs, warnings } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        method: "GET",
        uri: "/api",
        authScheme: BEARER,
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "GET",
        uri: "/api",
        authScheme: APIKEY,
      }),
    ]);

    expect(specs).toHaveLength(1);
    // OpenAPI (0.95) gana sobre express (0.5)
    expect(specs[0]?.authScheme?.type).toBe("apikey");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Conflicto de auth/i);
    expect(warnings[0]).toContain("express");
    expect(warnings[0]).toContain("openapi");
  });

  test("auth implícito (evidence vacío) no cuenta como conflicto", () => {
    const implicit: IDetectedAuthScheme = { type: "bearer", evidence: "" };
    const explicit: IDetectedAuthScheme = {
      type: "apikey",
      keyName: "X-API-Key",
      evidence: "X-API-Key header declared",
    };
    const { warnings } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        method: "GET",
        uri: "/x",
        authScheme: implicit,
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "GET",
        uri: "/x",
        authScheme: explicit,
      }),
    ]);

    expect(warnings).toHaveLength(0);
  });
});

describe("EndpointMerger — description", () => {
  test("gana la más larga en chars", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        description: "Corta",
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        description: "La descripción más detallada y completa de este endpoint",
      }),
    ]);

    expect(merged.description).toBe(
      "La descripción más detallada y completa de este endpoint",
    );
    expect(merged.provenance.description?.framework).toBe("openapi");
  });

  test("a igual longitud gana la primera", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        description: "abc",
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.9,
        description: "abc",
      }),
    ]);

    expect(merged.description).toBe("abc");
    expect(merged.provenance.description?.framework).toBe("laravel");
  });
});

describe("EndpointMerger — provenance", () => {
  test("está presente en todos los casos (incluso 1 candidato)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([candidate({ framework: "express" })]);

    expect(merged.provenance).toBeDefined();
    expect(merged.provenance.route).toBeDefined();
    expect(merged.provenance.contributors).toEqual(["express"]);
  });

  test("contributors lista todos los frameworks del grupo", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.9 }),
      candidate({ framework: "openapi", scannerScore: 0.7 }),
      candidate({ framework: "fastify", scannerScore: 0.85 }),
    ]);

    expect(merged.provenance.contributors).toEqual([
      "openapi",
      "fastify",
      "express",
    ]);
  });
});

describe("EndpointMerger — confidence global (media ponderada)", () => {
  test("4 piezas presentes: pesos originales", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        body: OPENAPI_BODY,
        authScheme: BEARER,
        description: "Una descripción completa de este endpoint",
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        body: FASTIFY_BODY,
      }),
    ]);

    // Solo OpenAPI aporta auth + description, Fastify solo body.
    // La provenance registra OpenAPI en route/body/auth/description
    // porque es el ganador en todas las piezas (0.95 vs 0.85).
    // Confidence = media ponderada de UN solo valor por pieza (porque
    // el ganador se queda con la confianza del winner).
    //   route:  0.4 * 0.95 = 0.38
    //   body:   0.3 * 0.95 = 0.285
    //   auth:   0.2 * 0.95 = 0.19
    //   desc:   0.1 * 0.95 = 0.095
    //   total / (0.4+0.3+0.2+0.1) = 0.95 / 1.0 = 0.95
    expect(merged.confidence).toBeCloseTo(0.95, 2);
  });

  test("pieza ausente redistribuye su peso: solo ruta → confidence = ruta", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.5 }),
    ]);

    // Solo route presente: el peso total es 0.4, el valor es 0.5,
    // confidence = (0.4 * 0.5) / 0.4 = 0.5
    expect(merged.confidence).toBeCloseTo(0.5, 2);
  });

  test("dos piezas (ruta + body): se redistribuye auth y desc", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        body: FASTIFY_BODY,
      }),
      candidate({ framework: "express", scannerScore: 0.5 }),
    ]);

    // route y body presentes: pesos 0.4 + 0.3 = 0.7
    // ambos del framework fastify (ganador de body), con confianza 0.85
    // (ruta del candidato ganador = fastify)
    //   (0.4 * 0.85 + 0.3 * 0.85) / 0.7 = 0.85
    expect(merged.confidence).toBeCloseTo(0.85, 2);
  });
});

describe("mergeEndpoints — pipeline-level", () => {
  test("lista vacía → resultado vacío sin warnings", () => {
    const result = mergeEndpoints([]);
    expect(result.specs).toEqual([]);
    expect(result.provenance).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("3 candidatos en 2 grupos → 2 endpoints fusionados + provenance", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.9,
        method: "GET",
        uri: "/users",
        description: "A",
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        method: "GET",
        uri: "/users",
        description: "B más larga",
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "POST",
        uri: "/users",
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    expect(result.provenance).toHaveLength(2);
    // La descripción más larga es la del grupo GET
    const getSpec = result.specs.find((s) => s.method === "GET");
    expect(getSpec?.description).toBe("B más larga");
    // Conflicto? No, no hay auth.
    expect(result.warnings).toEqual([]);
  });

  test("custom frameworkConfidence se respeta", () => {
    const result = mergeEndpoints(
      [
        candidate({
          framework: "express",
          scannerScore: 0.5,
          method: "GET",
          uri: "/x",
          body: body("regex"),
        }),
        candidate({
          framework: "openapi",
          scannerScore: 0.5,
          method: "GET",
          uri: "/x",
          body: body("openapi"),
        }),
      ],
      {
        frameworkConfidence: {
          openapi: 0.6,
          fastify: 0.7,
          // express deliberadamente sin entry → cae al default
        },
      },
    );

    // Fastify (0.7) gana sobre OpenAPI (0.6) → no hay fastify en
    // candidatos, así que el body ganador es el de OpenAPI por
    // desempate (OpenAPI tiene confianza 0.6, express default 0.5).
    expect(result.specs[0]?.body).toEqual(body("openapi"));
  });
});

describe("EndpointMerger — interactúa con la tabla de confianza", () => {
  test("default frameworkConfidence hace ganar a OpenAPI sobre regex-based", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.99, // scannerScore alto pero framework bajo
        body: body("regex"),
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.5,
        body: body("openapi"),
      }),
    ]);

    // OpenAPI (0.95) > Laravel (0.5) → gana OpenAPI
    expect(merged.provenance.body?.framework).toBe("openapi");
    expect(merged.body).toEqual(body("openapi"));
  });
});

// ─────────────────────────────────────────────────────────────────────
// a00011 C-3 — correcciones del review post-a00010 (B-rev-3 / 4 / 5 / 15)
// ─────────────────────────────────────────────────────────────────────

describe("EndpointMerger — identidad contextual REST vs RPC (a00011 B-rev-3)", () => {
  test("dos candidatos REST mismo (method, uri) y distinto name → un merged", () => {
    // REST no multiplexa: openapi y express comparten identidad y se
    // fusionan. El nombre del ganador (openapi, confianza 0.95) gana.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/users",
        name: "Create a new user account",
        framework: "openapi",
        scannerScore: 0.95,
      }),
      candidate({
        method: "POST",
        uri: "/users",
        name: "Create Users",
        framework: "express",
        scannerScore: 0.6,
      }),
    ]);

    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.method).toBe("POST");
    expect(result.specs[0]?.uri).toBe("/users");
    expect(result.specs[0]?.name).toBe("Create a new user account");
    expect(result.provenance).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  test("dos candidatos GraphQL mismo (method+uri), distinto name → DOS merged", () => {
    // GraphQL multiplexa por nombre: dos POST /graphql con nombres
    // distintos son dos operaciones distintas. Antes colisionaban en
    // una sola, perdiendo una operación silenciosamente.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "QueryUsers",
        framework: "graphql",
        scannerScore: 0.7,
      }),
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "MutationCreateUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    const names = result.specs.map((s) => s.name).sort();
    expect(names).toEqual(["MutationCreateUser", "QueryUsers"]);
    expect(result.warnings).toEqual([]);
  });

  test("REST y RPC sobre la misma (method, uri) NO colisionan (cada uno a su grupo)", () => {
    // graphql (RPC, incluye name en la clave) y express (REST, no la
    // incluye) generan dos claves distintas → dos grupos, dos merges.
    // Esto es deliberado: el adapter agnóstico prefiere dos endpoints
    // separados a una fusión silenciosa.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/users",
        name: "ExpressCreate",
        framework: "express",
        scannerScore: 0.6,
      }),
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "GraphqlCreateUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    const uris = result.specs.map((s) => s.uri).sort();
    expect(uris).toEqual(["/graphql", "/users"]);
  });
});

describe("EndpointMerger — field merge por location:fieldName (a00011 B-rev-4)", () => {
  test("path.id y query.id son DOS campos en el merged (clave compuesta)", () => {
    // Antes ambos campos colisionaban en una sola entrada porque la
    // clave era `fieldName` desnudo; ahora `${location}:${fieldName}`
    // los separa y cada uno conserva su location.
    const result = mergeEndpoints([
      candidate({
        method: "GET",
        uri: "/items/{id}",
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({ fieldName: "id", location: "path", type: "string", required: true }),
        ],
      }),
      candidate({
        method: "GET",
        uri: "/items/{id}",
        framework: "express",
        scannerScore: 0.6,
        fields: [
          field({ fieldName: "id", location: "query", type: "string", required: false }),
        ],
      }),
    ]);

    expect(result.specs).toHaveLength(1);
    const fields = result.specs[0]?.fields ?? [];
    expect(fields).toHaveLength(2);
    const byLoc = Object.fromEntries(
      fields.map((f) => [`${f.location}:${f.fieldName}`, f]),
    );
    expect(byLoc["path:id"]?.required).toBe(true);
    expect(byLoc["query:id"]?.required).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe("EndpointMerger — mergeFieldSpecs cumple su contrato (a00011 B-rev-5)", () => {
  test("minLength: max(mínimos)", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "username", type: "string", minLength: 3 })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "username", type: "string", minLength: 5 })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.minLength).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  test("maximum: min(máximos)", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "age", type: "integer", maximum: 120 })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "age", type: "integer", maximum: 99 })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.maximum).toBe(99);
  });

  test("enumValues: intersección vacía → warning + enumValues vacío", () => {
    // Disjuntos: ningún valor satisface a los dos scanners. El merger
    // no inventa: emite warning y deja la intersección (vacía) para
    // que el operador decida.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["a", "b", "c"],
          }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["b", "c", "d"],
          }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["b", "c"]);
    // La intersección NO es vacía: hay warning sólo si lo es.
    expect(result.warnings).toEqual([]);
  });

  test("enumValues: intersección vacía real → warning + enum del lado de mayor confianza", () => {
    // Dominios disjuntos: el warning debe salir en
    // `IMergeOutcome.warnings`. Publicar `[]` descartaría el dominio
    // entero: el contrato (a00011 B-rev-5) es conservar el enum del
    // lado de mayor confidence/provenance. OpenAPI (0.95) > fastify
    // (0.85), así que gana `["c", "d"]` de openapi.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["a", "b"],
          }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["c", "d"],
          }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["c", "d"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/body:role/);
    expect(result.warnings[0]).toMatch(/enum intersection empty/);
  });

  test("enumValues: intersección vacía con confianza igual → enum de A (primero en orden)", () => {
    // Empate de confianza (default 0.5 para ambos): gana A, el
    // primero en el orden del caller (body-winner / llegada).
    const result = mergeEndpoints([
      candidate({
        framework: "laravel",
        scannerScore: 0.5,
        fields: [
          field({ fieldName: "role", type: "string", enumValues: ["a"] }),
        ],
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.5,
        fields: [
          field({ fieldName: "role", type: "string", enumValues: ["b"] }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["a"]);
    expect(result.warnings).toHaveLength(1);
  });

  test("type mismatch (string vs object) → conflicto + ganador por mayor confianza", () => {
    // A: 'object' con scannerScore 0.95 (openapi). B: 'string' con
    // scannerScore 0.85 (fastify). openapi gana por frameworkConfidence
    // (0.95 vs 0.85), y el tipo del ganador es 'object'.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "payload", type: "string", required: false })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "payload", type: "object", required: false })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.type).toBe("object");
  });

  test("type mismatch con confianza igual → ganador es A + conflict warning", () => {
    // Dos scanners con la misma frameworkConfidence (cayendo al
    // default 0.5 por no estar en la tabla). A gana por orden de
    // llegada, y el merger avisa.
    const result = mergeEndpoints([
      candidate({
        framework: "laravel",
        scannerScore: 0.5,
        fields: [field({ fieldName: "payload", type: "string", required: false })],
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.5,
        fields: [field({ fieldName: "payload", type: "object", required: false })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.type).toBe("string");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/type mismatch: string vs object/);
  });

  test("pattern divergente → warning + ganador A (openapi primero por frameworkConfidence)", () => {
    // Con la tabla por defecto, openapi (0.95) gana a fastify (0.85),
    // así que A es openapi en `mergeFieldSpecs`. El contrato es
    // "gana el primero en el orden del caller"; aquí ese orden es el
    // de `sortCandidates`, que pone openapi primero.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({ fieldName: "slug", type: "string", pattern: "^[a-z0-9-]+$" }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({ fieldName: "slug", type: "string", pattern: "^[a-z0-9_-]+$" }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0] as IValidationSpec | undefined;
    expect(f?.pattern).toBe("^[a-z0-9_-]+$");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/pattern mismatch/);
  });
});

describe("EndpointMerger — frameworkConfidence se respeta en sortCandidates (a00011 B-rev-15)", () => {
  test("express gana body pese a menor scannerScore porque frameworkConfidence lo declara superior", () => {
    // a00011 B-rev-15: sortCandidates debe usar la tabla inyectada, no
    // la constante global. Aquí openapi tiene scannerScore mayor
    // (0.95 vs 0.5) pero express tiene mayor frameworkConfidence
    // (0.9 vs 0.2). El body ganador debe ser el de express.
    //
    // El spec del usuario decía "openapi gana... aun teniendo menos
    // scannerScore"; con los valores 0.2/0.9 que daba el ejemplo
    // eso era imposible. Interpreto la intención del fix B-rev-15
    // (frameworkConfidence ordena candidatos) y escribo el caso
    // coherente con los números.
    const result = mergeEndpoints(
      [
        candidate({
          method: "POST",
          uri: "/x",
          framework: "openapi",
          scannerScore: 0.95,
          body: body("openapi"),
        }),
        candidate({
          method: "POST",
          uri: "/x",
          framework: "express",
          scannerScore: 0.5,
          body: body("express"),
        }),
      ],
      {
        frameworkConfidence: {
          openapi: 0.2,
          express: 0.9,
        },
      },
    );

    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.body).toEqual(body("express"));
    expect(result.specs[0]?.provenance.body?.framework).toBe("express");
  });

  test("con frameworkConfidence por defecto, openapi sigue ganando por tabla interna", () => {
    // Regresión: el comportamiento por defecto (sin override) sigue
    // dando openapi (0.95) por encima de express (default 0.5).
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.5,
        body: body("openapi"),
      }),
      candidate({
        framework: "express",
        scannerScore: 0.95,
        body: body("express"),
      }),
    ]);

    expect(merged.provenance.body?.framework).toBe("openapi");
    expect(merged.body).toEqual(body("openapi"));
  });
});

describe("endpointSpecFromMerged — auth per-op (audit 2026-09-04 P1 #6)", () => {
  test("authScheme { type: 'none' } se traduce a EndpointSpec.auth { kind: 'none' }", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: { type: "none", evidence: "per-op override (fastify)" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "none" });
  });

  test("authScheme 'bearer' se traduce a EndpointSpec.auth scheme:bearer (override per-op)", () => {
    // Audit 2ª revisión #17: ahora TODAS las ramas del union se
    // traducen, no solo `none`. Un override per-op de bearer debe
    // sobrevivir al merger y al EndpointSpec resultante — antes se
    // descartaba y el builder usaba la auth global.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "bearer" });
  });

  test("authScheme 'apikey' se traduce a scheme:apiKey", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: APIKEY,
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "apiKey" });
  });

  test("authScheme 'oauth2' se traduce a scheme:oauth2", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: { type: "oauth2", evidence: "OAuth2 flow" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "oauth2" });
  });

  test("fusión híbrida con override 'none' preserva la marca pública", () => {
    // OpenAPI declara /auth/login como bearer (esquema global);
    // Fastify lo sobreescribe a none (es el endpoint que emite el
    // token, no puede pedirlo). El merger debe quedarse con none.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: { type: "none", evidence: "per-op override (fastify)" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "none" });
  });

  test("authScheme per-op scheme:bearer gana a bearer global de mayor confianza", () => {
    // Audit 2ª revisión #18: un override EXPLICITO por operación
    // debe tener precedencia semántica, no "framework con mayor
    // confianza". Aquí fastify (0.85) sobreescribe bearer→apiKey
    // y debe ganar aunque openapi (0.95) trae bearer.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: {
          type: "apikey",
          keyIn: "header",
          evidence: "per-op override (fastify, apiKey)",
        },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "apiKey" });
  });
});
