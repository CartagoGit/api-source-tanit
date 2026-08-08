/**
 * El contrato de salida de los cuatro tools del plugin.
 *
 * `AGENT-BOOTSTRAP.md#L62` copia por referencia el invariante universal
 * §6 —"Every public tool declares an `outputSchema`"— y §3.2 lo repite.
 * **Ninguno de los cuatro lo declaraba.** Un agente que llamaba a
 * `mcp-vertex_expostman_generate` recibía una salida sin contrato: no
 * podía validar la respuesta ni saber qué campos existen sin ejecutarla
 * y mirar lo que salía.
 *
 * Al escribir los esquemas salieron dos cosas más, que es lo que suele
 * pasar cuando se obliga a un contrato a existir:
 *
 *   - `summary` declaraba seis campos en su interfaz y devolvía los
 *     dieciocho del resumen con `toolJson({ ok: true, ...summary })`.
 *     El contrato escrito y el comportamiento llevaban tiempo sin
 *     coincidir, y no había forma de notarlo.
 *   - `validate` y `test` usaban `ok` para dos preguntas distintas:
 *     "¿funcionó la herramienta?" y "¿salió bien el resultado?".
 *     `validate` llegaba a devolver `toolError` con una colección
 *     desincronizada, lo que marca la respuesta con `isError` — el
 *     agente que pregunta "¿está al día?" recibía un fallo de
 *     herramienta en vez de la respuesta "no, y estos son los motivos".
 */
import { describe, expect, test } from "vitest";

import {
  GenerateOutputSchema,
  SummaryOutputSchema,
  TestOutputSchema,
  ValidateOutputSchema,
} from "../../projects/plugins/mcp-vertex_expostman/src/lib/contracts/plugin.interface";

const SCHEMAS = {
  generate: GenerateOutputSchema,
  validate: ValidateOutputSchema,
  summary: SummaryOutputSchema,
  test: TestOutputSchema,
} as const;

describe("los cuatro tools declaran su salida", () => {
  test.for(Object.entries(SCHEMAS))("%s tiene esquema de salida", ([, schema]) => {
    expect(schema).toBeDefined();
    expect(typeof schema.safeParse).toBe("function");
  });

  /**
   * `ok: true` fijo, no `boolean`. El fallo tiene su propio sobre
   * universal (`toolError` → `{ ok: false, error }` con `isError`), así
   * que un esquema de salida que admitiera `ok: false` estaría
   * describiendo dos contratos a la vez.
   */
  test.for(Object.entries(SCHEMAS))("%s fija `ok` en true", ([name, schema]) => {
    const conFalse = schema.safeParse({ ok: false });
    expect(conFalse.success, `${name} acepta ok:false`).toBe(false);
  });
});

describe("`ok` y el resultado son dos preguntas distintas", () => {
  test("una colección desincronizada es una validación que funcionó", () => {
    const parsed = ValidateOutputSchema.safeParse({
      ok: true,
      valid: false,
      routesInSource: 9,
      requestsInCollection: 4,
      issues: [{ severity: "error", message: "faltan 5 en la colección" }],
      durationMs: 120,
    });
    expect(parsed.success).toBe(true);
  });

  test("un test en rojo es un resultado, no un fallo del tool", () => {
    const parsed = TestOutputSchema.safeParse({
      ok: true,
      passed: false,
      steps: [{ name: "typecheck", ok: false, exitCode: 1, durationMs: 30 }],
      durationMs: 30,
      framework: null,
    });
    expect(parsed.success).toBe(true);
  });

  test("`valid` y `passed` son obligatorios: sin ellos no se sabe el resultado", () => {
    expect(
      ValidateOutputSchema.safeParse({
        ok: true,
        routesInSource: 0,
        requestsInCollection: 0,
        issues: [],
        durationMs: 1,
      }).success,
    ).toBe(false);
    expect(
      TestOutputSchema.safeParse({ ok: true, steps: [], durationMs: 1, framework: null })
        .success,
    ).toBe(false);
  });
});

describe("el esquema describe lo que el tool devuelve de verdad", () => {
  /**
   * EL test de `summary`: los campos que el handler pasa y la interfaz
   * anterior no declaraba. Sin esto, el esquema podría volver a
   * quedarse corto y nadie lo notaría.
   */
  test("summary cubre el resumen entero, no seis campos de dieciocho", () => {
    const completo = {
      ok: true,
      framework: "express",
      frameworks: ["express"],
      projectName: "sample",
      baseUrl: "http://localhost:3000",
      routesInCode: 9,
      withFormRequest: 2,
      withoutFormRequest: 7,
      bodiesAdded: 3,
      queriesAdded: 1,
      zeroConfig: true,
      configPath: "<zero-config>",
      manualEndpoints: 0,
      inferredVariables: 2,
      auth: { loginEndpoint: "POST /login" },
      warnings: [],
    };
    expect(SummaryOutputSchema.safeParse(completo).success).toBe(true);
  });

  test("generate acepta el proyecto híbrido y el que no reconoce nada", () => {
    const base = {
      ok: true,
      warnings: [],
      collectionPath: "/tmp/c.json",
      collectionId: "abc",
      environmentPaths: [],
      extraPaths: [],
      requests: 9,
      folders: 3,
      auth: null,
      durationMs: 100,
    };
    expect(
      GenerateOutputSchema.safeParse({
        ...base,
        framework: "express",
        frameworks: ["express", "nextjs"],
      }).success,
    ).toBe(true);
    // Nada reconocido: `framework` es null y no es un error de forma.
    expect(
      GenerateOutputSchema.safeParse({ ...base, framework: null, frameworks: [] }).success,
    ).toBe(true);
  });

  test("los contadores no admiten negativos", () => {
    expect(
      SummaryOutputSchema.safeParse({
        ok: true,
        framework: "express",
        frameworks: [],
        projectName: "x",
        baseUrl: "y",
        routesInCode: -1,
        withFormRequest: 0,
        withoutFormRequest: 0,
        bodiesAdded: 0,
        queriesAdded: 0,
        zeroConfig: true,
        configPath: "<zero-config>",
        manualEndpoints: 0,
        inferredVariables: 0,
        auth: null,
        warnings: [],
      }).success,
    ).toBe(false);
  });
});
