/**
 * The output contract of the four plugin tools.
 *
 * `AGENT-BOOTSTRAP.md#L62` copies by reference the universal invariant
 * §6 —"Every public tool declares an `outputSchema`"— and §3.2 repeats
 * it. **None of the four declared it.** An agent that called
 * `delendai_tanit_generate` received an output without a contract: it
 * could not validate the response nor know which fields existed
 * without running it and looking at what came out.
 *
 * When writing the schemas, two more things came out, which is what
 * usually happens when a contract is forced to exist:
 *
 *   - `summary` declared six fields in its interface and returned the
 *     eighteen of the summary with `toolJson({ ok: true, ...summary })`.
 *     The written contract and the behavior had not agreed for a
 *     while, and there was no way to notice it.
 *   - `validate` and `test` used `ok` for two different questions:
 *     "did the tool work?" and "did the result come out well?".
 *     `validate` even returned `toolError` with an out-of-sync
 *     collection, which marks the response with `isError` — the
 *     agent that asks "is it up to date?" received a tool failure
 *     instead of the answer "no, and these are the reasons".
 */
import { describe, expect, test } from "vitest";

/**
 * This spec needs the **plugin's** dependencies, not the package's:
 * the schemas are built with `zod`, which is theirs.
 *
 * And those are not always there. The plugin declares
 * `"@delendai/core": "file:../../../../delendai/packages/core"`, a
 * `file:` pointing outside the repository, so anywhere without the
 * sibling checkout —a clean container, a CI, a fresh clone— the
 * workspace install stays half-done and `zod` does not arrive. The
 * symptom is an undefined `z.object` that has nothing to do with
 * what this file tests.
 *
 * The precondition is declared here, not excluded from outside,
 * because the condition is this spec's. When `p00007` closes and
 * the package comes from npm, this is unnecessary.
 */
/**
 * An attempt is made to load and we check whether it loads. Nothing
 * about checking paths or loose dependencies: the condition is
 * exactly "can this module be used?", and asking it any other way
 * is guessing.
 *
 * It was once tested by checking if `node_modules/zod` existed —
 * and it did, but half-installed, so the spec kept blowing up.
 * The disk said yes and reality said no.
 */
<<<<<<< Updated upstream:tests/cli/mcp-surface.spec.ts
const contratos = await import(
  "../../packages/plugins/delendai_tanit/src/lib/contracts/plugin.interface"
).catch(() => null);
=======
const contratos = await import("../../src/lib/contracts/plugin.interface").catch(
  () => null,
);
>>>>>>> Stashed changes:packages/plugins/delendai_tanit/tests/integration/mcp-surface.spec.ts

const PLUGIN_DEPS = contratos !== null;

/**
 * The import is **dynamic** and goes behind the check, not above.
 *
 * `describe.skipIf` arrives late: the module is evaluated when
 * imported, and if `zod` is missing it blows up with undefined
 * `z.object` before any `skip` can act. A static import would make
 * this file take down the whole suite instead of skipping itself.
 */
const SCHEMAS = {
  generate: contratos?.GenerateOutputSchema,
  validate: contratos?.ValidateOutputSchema,
  summary: contratos?.SummaryOutputSchema,
  test: contratos?.TestOutputSchema,
} as const;

describe.skipIf(!PLUGIN_DEPS)("the four tools declare their output", () => {
  test.for(Object.entries(SCHEMAS))("%s has an output schema", ([, schema]) => {
    expect(schema).toBeDefined();
    expect(typeof schema?.safeParse).toBe("function");
  });

  /**
   * `ok: true` fixed, not `boolean`. The failure has its own
   * universal envelope (`toolError` → `{ ok: false, error }` with
   * `isError`), so an output schema that admitted `ok: false` would
   * be describing two contracts at once.
   */
  test.for(Object.entries(SCHEMAS))("%s fixes `ok` to true", ([name, schema]) => {
    const conFalse = schema?.safeParse({ ok: false });
    expect(conFalse?.success, `${name} accepts ok:false`).toBe(false);
  });
});

describe.skipIf(!PLUGIN_DEPS)("`ok` and the result are two different questions", () => {
  test("an out-of-sync collection is a validation that worked", () => {
    const parsed = contratos!.ValidateOutputSchema.safeParse({
      ok: true,
      valid: false,
      routesInSource: 9,
      requestsInCollection: 4,
      issues: [{ severity: "error", message: "faltan 5 en la colección" }],
      durationMs: 120,
    });
    expect(parsed.success).toBe(true);
  });

  test("a failing test is a result, not a tool failure", () => {
    const parsed = contratos!.TestOutputSchema.safeParse({
      ok: true,
      passed: false,
      steps: [{ name: "typecheck", ok: false, exitCode: 1, durationMs: 30 }],
      durationMs: 30,
      framework: null,
    });
    expect(parsed.success).toBe(true);
  });

  test("`valid` and `passed` are mandatory: without them the result is unknown", () => {
    expect(
      contratos!.ValidateOutputSchema.safeParse({
        ok: true,
        routesInSource: 0,
        requestsInCollection: 0,
        issues: [],
        durationMs: 1,
      }).success,
    ).toBe(false);
    expect(
      contratos!.TestOutputSchema.safeParse({ ok: true, steps: [], durationMs: 1, framework: null })
        .success,
    ).toBe(false);
  });
});

describe.skipIf(!PLUGIN_DEPS)("the schema describes what the tool actually returns", () => {
  /**
   * THE `summary` test: the fields the handler passes and the
   * previous interface did not declare. Without this, the schema
   * could fall short again and nobody would notice.
   */
  test("summary covers the whole summary, not six of eighteen fields", () => {
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
      evidence: [],
      health: {
        withValidationPercent: 22,
        withBodySchemaPercent: 33,
        withExamplesPercent: 33,
        withDescriptionPercent: 0,
      },
    };
    expect(contratos!.SummaryOutputSchema.safeParse(completo).success).toBe(true);
  });

  test("generate accepts the hybrid project and the one that recognises nothing", () => {
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
      contratos!.GenerateOutputSchema.safeParse({
        ...base,
        framework: "express",
        frameworks: ["express", "nextjs"],
      }).success,
    ).toBe(true);
    // Nothing recognised: `framework` is null and it is not a shape error.
    expect(
      contratos!.GenerateOutputSchema.safeParse({ ...base, framework: null, frameworks: [] }).success,
    ).toBe(true);
  });

  test("counters do not admit negative numbers", () => {
    expect(
      contratos!.SummaryOutputSchema.safeParse({
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
        health: {
          withValidationPercent: 0,
          withBodySchemaPercent: 0,
          withExamplesPercent: 0,
          withDescriptionPercent: 0,
        },
      }).success,
    ).toBe(false);
  });
});
