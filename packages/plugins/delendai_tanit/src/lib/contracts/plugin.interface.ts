/**
 * Types for the `tanit` plugin's domain.
 *
 * They keep the contract clean: the plugin does NOT depend on the
 * internal implementation of the Tanit project (which lives in
 * `../../contracts/`, `../../services/`). It only defines the inputs
 * and outputs an agent sees when invoking the tools.
 */

import { z } from "zod";

import { FRAMEWORK_IDS } from "../../../../../contracts/constants/frameworks/framework-ids.constant";
import { EXPORT_FORMATS } from "../../../../../contracts/constants/core/export-formats.constant";
import type { IProjectSummary } from "../../../../../contracts/interfaces/core/domain.interface";
import type { ICheckReport } from "../../../../../contracts/interfaces/cli/command-outcomes.interface";
import type { IStatsOutcome } from "../../../../../contracts/interfaces/cli/stats-outcome.interface";
import type { IScanOutcome } from "../../../../../contracts/interfaces/cli/scan-outcome.interface";
import type { IPushOutcome } from "../../../../../contracts/interfaces/cli/push-outcome.interface";
import type { IInitOutcome } from "../../../../../contracts/interfaces/cli/init-outcome.interface";

// --- Plugin options (read from delendai.config.json) -----------------------

export const TanitOptionsSchema = z
  .object({
    /**
     * Default path to the host project when the agent does not
     * pass it explicitly. The full fallback chain is:
     *   `args.projectRoot ?? defaultProjectRoot ?? workspaceRoot`.
     * If none resolves, the tool returns a clear error.
     */
    defaultProjectRoot: z.string().min(1).optional(),
    /**
     * Path to the Tanit package's CLI script.
     *
     * The default lives in `cli-path.constant.ts`, not here: this
     * sentence used to say `scripts/cli.script.ts` long after the CLI
     * moved into `packages/`, which is exactly why there is now a
     * single place where it is written and a test that verifies it.
     */
    cliScript: z.string().min(1).optional(),
    /**
     * Absolute path to the `bun` binary the plugin uses to invoke the
     * CLI. It is read once at boot (not on every tool call) and passed
     * to `runner.helper` via `IRunnerContext.bunBin`. If not set, the
     * helper falls back to `DELENDAI_BUN_BIN` from the environment,
     * then to `Bun.which("bun")` / `command -v bun`.
     *
     * This option exists so that AI hosts that filter `PATH` before
     * spawning (some MCP clients strip variables) can guarantee the
     * plugin finds its binary. Without it, the plugin depends on the
     * `PATH` of whoever starts the host.
     */
    delendaiBunBin: z.string().min(1).optional(),
    /**
     * Subdirectory of the framework inside the project. f00011 S3.
     *
     * When the project is a monorepo (`turbo.json`,
     * `pnpm-workspace.yaml`, ...) or a project where the manifest is
     * at the root but the framework code lives in a subdir, the
     * orchestrator's autodetection looks at the root by default and
     * finds nothing. With this option the plugin passes the subdir to
     * the CLI (`--framework-search-root <sub>`) and the orchestrator
     * attaches it to the `match.frameworkSearchRoot` that the
     * scanners already read (f00011 S1).
     *
     * Without this option, the orchestrator auto-detects when there
     * is a single workspace in the monorepo; with several it does not
     * choose on its own and returns a warning.
     *
     * **Never absolute.** The project root is fixed by
     * `defaultProjectRoot ?? ctx.workspace`; this field only adds a
     * POSIX segment. The CLI validates it before passing it to the
     * pipeline, so the plugin does not have to repeat the check.
     */
    frameworkSearchRoot: z.string().min(1).optional(),
  })
  .strict();

export type ITanitOptions = z.infer<
  typeof TanitOptionsSchema
>;

// --- Tool inputs -------------------------------------------------------------

/**
 * `projectRoot` is now OPTIONAL in the 3 tools.
 * The canonical fallback at runtime is:
 *   `args.projectRoot ?? ctx.options.defaultProjectRoot ?? ctx.workspace`.
 * We decided to do it in the handler (not in zod) so the schema
 * stays declarative and the behaviour is explicit.
 */
export const GenerateInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
    envs: z.array(z.string().min(1)).optional(),
    openAfter: z.boolean().optional(),
    /**
     * Framework forced, bypassing autodetection.
     *
     * It is the escape hatch for projects where manifest-based
     * detection CANNOT succeed: a monorepo whose `package.json` lives
     * at the root, a dependency with an alias, a manifest generated
     * at build time. Without this, an agent that receives "nothing
     * detected" has no way to leverage that the person it is helping
     * knows which framework their API is.
     *
     * The list comes from the contracts catalogue, same as in
     * `test`: a hand-written list would reject the twentieth
     * framework the day it gets added. It used to come from
     * `frameworks/index`, which dragged in all twenty-one scanners
     * just to read twenty-one names.
     */
    framework: z.enum([...FRAMEWORK_IDS]).optional(),
    /**
     * Subdirectory of the framework inside the project. f00011 S3.
     *
     * When the project is a monorepo or has the manifest at the root
     * and the code in a subdir, this option travels to the CLI's
     * `--framework-search-root`. The agent can pass it here, or the
     * host can pre-set it in `delendai.config.json`
     * (`TanitOptionsSchema.frameworkSearchRoot`); the latter wins
     * when both are set.
     *
     * The value is validated in `generation.pipeline.ts`: it cannot
     * be absolute or contain `..`.
     */
    frameworkSearchRoot: z.string().min(1).optional(),
    /**
     * Output formats. Defaults to Postman only.
     *
     * There are six, and the plugin only reached the first one, so an
     * agent asked to "give me the OpenAPI of this API" had no way to
     * do it even though the CLI knew how.
     *
     * The list comes from the exporters registry, same as `framework`
     * comes from the scanners registry: a hand-written list would
     * reject the seventh the day it gets added.
     */
    formats: z
      .array(z.enum([...EXPORT_FORMATS]))
      .optional(),
  })
  .strict();

export type IGenerateInput = z.infer<typeof GenerateInputSchema>;

export const ValidateInputSchema = z
  .object({
    collectionPath: z.string().min(1),
    projectRoot: z.string().min(1).optional(),
  })
  .strict();

export type IValidateInput = z.infer<typeof ValidateInputSchema>;

export const SummaryInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
  })
  .strict();

export type ISummaryInput = z.infer<typeof SummaryInputSchema>;

/**
 * Health of the project's documentation, in percentages `0..100`.
 *
 * Zod mirror of `IProjectHealth` (contracts). Each field answers
 * "out of how many endpoints the collection will carry this piece":
 * with them an agent sees whether the API is well-documented
 * **before** generating, without opening the collection to count
 * manually.
 */
export const ProjectHealthSchema = z
  .object({
    withValidationPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("% de endpoints cuyas reglas de validación se resolvieron."),
    withBodySchemaPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "% de endpoints con body de ejemplo (de reglas resueltas o inferido).",
      ),
    withExamplesPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "% de endpoints que llevan al menos un ejemplo de valor (body o params).",
      ),
    withDescriptionPercent: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("% de endpoints con descripción."),
  })
  .strict();

export type IProjectHealthOutput = z.infer<typeof ProjectHealthSchema>;

/**
 * Inputs of the `test` tool. By default it runs the full e2e suite
 * of the Tanit package itself (already in the workspace). If
 * `framework` is passed, it runs a smoke test against the
 * corresponding fixture (`tests/fixtures/<framework>-comprehensive/`).
 */
export const TestInputSchema = z
  .object({
    /**
     * If given, runs a smoke test against that framework's fixture.
     * Valid values come from the scanners registry, so a new framework
     * is accepted without touching this file.
     */
    framework: z
      // The list is NOT hand-written: it comes from the contracts
      // catalogue. It used to be an `enum` with twelve names, and
      // adding the thirteenth made the plugin reject it as invalid
      // input — the same class of parallel list that made `summary`
      // diverge from `generate`.
      .enum([...FRAMEWORK_IDS])
      .optional(),
    /**
     * If `true`, runs `bun run typecheck` in addition to `bun test`.
     * Default: true.
     */
    withTypecheck: z.boolean().optional(),
  })
  .strict();

export type ITestInput = z.infer<typeof TestInputSchema>;

// --- Tool outputs ------------------------------------------------------------

/**
 * The four tools declare `outputSchema`, and it is not a flourish.
 *
 * The universal invariant §6 — copied by reference into
 * `AGENT-BOOTSTRAP.md` and repeated in §3.2 — says every public tool
 * declares one. None of them did. An agent calling `tanit_generate`
 * got an output with no contract: it could not validate the response
 * or know which fields exist without executing it and looking at
 * what came back. And this is the project's **public** surface
 * toward other agents, which is exactly where a contract matters
 * the most.
 *
 * The schemas describe **success**, with `ok: z.literal(true)`. The
 * error does not live here: `toolError` has its own universal
 * envelope (`{ ok: false, error: { reason, nextAction? } }`) and
 * marks the response with `isError`, so a client distinguishes it
 * without each tool repeating that shape. It is the same split the
 * host's tools use.
 *
 * The types are derived from the schemas with `z.infer`, not written
 * twice: a hand-written interface next to a schema is two sources of
 * truth that drift apart the first chance they get.
 */

/** What `generate` returns when the collection has been written. */
export const GenerateOutputSchema = z.object({
  ok: z.literal(true),
  framework: z
    .string()
    .nullable()
    .describe("Framework detectado, o null si no se reconoció ninguno."),
  frameworks: z
    .array(z.string())
    .describe("Más de uno = proyecto híbrido: se han escaneado y fusionado todos."),
  warnings: z
    .array(z.string())
    .describe("Avisos accionables. No son errores: la colección existe igual."),
  collectionPath: z
    .string()
    .nullable()
    .describe("null solo si no se llegó a escribir la colección."),
  collectionId: z
    .string()
    .nullable()
    .describe("`_postman_id`: lo que hace que reimportar actualice en vez de duplicar."),
  environmentPaths: z
    .array(z.string())
    .describe("Un fichero de environment por entorno pedido."),
  extraPaths: z
    .array(z.string())
    .describe(
      "Ficheros de formatos distintos de Postman (OpenAPI, Insomnia, Bruno, HAR, cURL). " +
        "Van aparte de environmentPaths porque no son environments: son la misma API en otro idioma.",
    ),
  requests: z.number().int().nonnegative().describe("Requests en la colección."),
  folders: z.number().int().nonnegative().describe("Carpetas en la colección."),
  auth: z
    .object({
      loginEndpoint: z.string(),
      tokenVariable: z.string(),
    })
    .nullable()
    .describe("null si el proyecto no tiene endpoint de login."),
  durationMs: z.number().nonnegative().describe("Lo que tardó el CLI, en ms."),
});

export type IGenerateOutput = z.infer<typeof GenerateOutputSchema>;

/** What `validate` returns on an already-written collection. */
export const ValidateOutputSchema = z.object({
  ok: z.literal(true),
  valid: z
    .boolean()
    .describe(
      "Si la colección pasa la validación. Distinto de `ok`, que solo dice " +
        "que la comprobación se pudo hacer: una colección inválida se " +
        "reporta bien, no es un fallo del tool.",
    ),
  routesInSource: z.number().int().nonnegative().describe("Rutas encontradas en el código."),
  requestsInCollection: z
    .number()
    .int()
    .nonnegative()
    .describe("Requests que hay en la colección."),
  issues: z
    .array(
      z.object({
        severity: z.enum(["error", "warning"]),
        message: z.string(),
      }),
    )
    .describe("Lista vacía cuando no hay nada que decir."),
  durationMs: z.number().nonnegative(),
});

export type IValidateOutput = z.infer<typeof ValidateOutputSchema>;

/**
 * What `summary` returns: the project as seen from the code, without
 * generating anything.
 *
 * It describes the **whole** summary, which is what the tool
 * actually returns. The previous interface declared six fields
 * while the handler did `toolJson({ ok: true, ...summary })` and
 * returned all eighteen: the written contract and the actual
 * behaviour had been out of sync for a while, and nobody could
 * notice because there was no schema to confront them.
 */
export const SummaryOutputSchema = z.object({
  ok: z.literal(true),
  framework: z.string().describe('Framework detectado, o "unknown".'),
  frameworks: z
    .array(z.string())
    .describe("Más de uno = proyecto híbrido; `framework` es el de más confianza."),
  projectName: z.string().describe("Nombre deducido del manifiesto del proyecto."),
  baseUrl: z.string().describe("URL base que se usará en los environments."),
  routesInCode: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Endpoints que acabarían en la colección, no líneas de código: un " +
        "`apiResource` de Laravel es una línea y siete endpoints.",
    ),
  withFormRequest: z
    .number()
    .int()
    .nonnegative()
    .describe("Endpoints cuyas reglas de validación se resolvieron."),
  withoutFormRequest: z
    .number()
    .int()
    .nonnegative()
    .describe("Endpoints sin reglas: su body sale de la inferencia agnóstica."),
  bodiesAdded: z.number().int().nonnegative(),
  queriesAdded: z.number().int().nonnegative(),
  zeroConfig: z
    .boolean()
    .describe("true cuando no hace falta fichero de configuración ninguno."),
  configPath: z.string().describe("`<zero-config>` cuando no hay fichero."),
  manualEndpoints: z.number().int().nonnegative(),
  inferredVariables: z.number().int().nonnegative(),
  auth: z
    .object({ loginEndpoint: z.string() })
    .nullable()
    .describe("null si el proyecto no expone endpoint de login."),
  warnings: z
    .array(z.string())
    .describe("Avisos accionables: proyecto híbrido, nada reconocido…"),
  // f00010 S3: the signals that drove the framework's selection. The
  // UI renders them as cards; the agent can reuse them to answer
  // "why Laravel?" without having to re-scan.
  evidence: z
    .array(
      z.object({
        signal: z.string().describe("Lo que el detector vio, en una línea."),
        weight: z
          .number()
          .describe("Subida al score (puede ser negativo si el detector restó)."),
        artifact: z
          .string()
          .optional()
          .describe("Fichero del que se leyó la señal, relativo al projectRoot."),
      }),
    )
    .describe(
      "Vacío si el detector aún no se ha enriquecido; se rellena progresivamente.",
    ),
  // f00010 S2: documentation health, in percentages. On the final
  // specs (the same ones `generate` would feed), so what the health
  // says is what the collection will carry.
  health: ProjectHealthSchema.describe(
    "Salud de la documentación, en porcentajes 0..100. 0 en todo con cero endpoints.",
  ),
});

export type ISummaryOutput = z.infer<typeof SummaryOutputSchema>;

/**
 * The schema must cover the entire contract.
 *
 * This is not a decorative check: it is what prevents what already
 * happened from happening again. `SummaryOutputSchema` declared 6
 * fields while the handler did `toolJson({ ok: true, ...summary })`
 * and returned all eighteen: the written contract and the actual
 * behaviour had been out of sync for a while, and nobody could
 * notice because there was nothing to confront them.
 *
 * With this line, adding a field to `IProjectSummary` and forgetting
 * the schema **will not compile**. Extra fields are allowed — the
 * tool adds `ok` — because what is checked is that none are missing.
 * It is the one that caught `health` the day `IProjectSummary`
 * introduced it: without it, `SummaryOutputSchema` would have kept
 * describing the summary from two slices ago.
 */
const _summaryCubreElContrato: z.ZodType<{ ok: true } & IProjectSummary> =
  SummaryOutputSchema;
void _summaryCubreElContrato;

/** A step of `test`: the execution of a sub-command. */
export const TestStepSchema = z.object({
  name: z.string().describe("`typecheck`, `test e2e`, `smoke:<framework>`…"),
  ok: z.boolean(),
  exitCode: z.number().int(),
  durationMs: z.number().nonnegative(),
  summary: z.string().optional().describe("Resumen corto: cuántos tests, typecheck limpio…"),
  detail: z.string().optional().describe("Si falló, el primer fragmento relevante."),
});

export type ITestStep = z.infer<typeof TestStepSchema>;

/** Lo que devuelve `test`. */
export const TestOutputSchema = z.object({
  ok: z.literal(true),
  passed: z
    .boolean()
    .describe(
      "Si todos los pasos pasaron. Distinto de `ok`: un test en rojo es " +
        "un resultado legítimo del tool, no un fallo suyo.",
    ),
  steps: z.array(TestStepSchema),
  durationMs: z.number().nonnegative(),
  framework: z
    .string()
    .nullable()
    .describe("El framework del smoke, o null si solo se corrió la suite genérica."),
});

export type ITestOutput = z.infer<typeof TestOutputSchema>;

// --- `check`: the question an agent most wants to ask ------------------------

/**
 * `check` input.
 *
 * It is the tool that was missing, and the most striking one of the
 * missing ones: it answers "has my collection drifted from the
 * code?", which is exactly what an agent wants to know before
 * touching anything. It existed in the CLI from the start and was
 * not exposed.
 */
export const CheckInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** The collection to compare. If missing, the one for the project. */
    collectionPath: z.string().min(1).optional(),
  })
  .strict();

export type ICheckInput = z.infer<typeof CheckInputSchema>;

/** Un endpoint que esta en un lado y no en el otro. */
export const DriftedEndpointSchema = z.object({
  method: z.string(),
  uri: z.string(),
  name: z
    .string()
    .optional()
    .describe(
      "El nombre de la operacion, cuando el protocolo lo necesita. En " +
        "GraphQL o tRPC todas comparten metodo y URL, asi que sin esto " +
        "la lista serian varias lineas identicas.",
    ),
});

/** Lo que devuelve `check`. */
export const CheckOutputSchema = z.object({
  ok: z.literal(true),
  inSync: z
    .boolean()
    .describe(
      "Distinto de `ok`: `ok` dice que la comprobacion se pudo hacer, " +
        "`inSync` dice el resultado. Una coleccion desincronizada " +
        "detectada es una comprobacion que ha funcionado.",
    ),
  routesInSource: z.number().int().nonnegative(),
  requestsInCollection: z.number().int().nonnegative(),
  missingInCollection: z
    .array(DriftedEndpointSchema)
    .describe("Estan en el codigo y no en la coleccion: falta regenerar."),
  missingInSource: z
    .array(DriftedEndpointSchema)
    .describe("Estan en la coleccion y no en el codigo: se borraron o renombraron."),
  durationMs: z.number().nonnegative(),
});

export type ICheckOutput = z.infer<typeof CheckOutputSchema>;

/**
 * Same as in `summary`: the schema must cover the entire report.
 *
 * `ICheckReport` is what the command produces; the tool adds `ok`
 * and `durationMs`. If tomorrow the report gains a field and the
 * schema does not, this stops compiling instead of returning an
 * output the tool's contract does not describe.
 */
const _checkCubreElInforme: z.ZodType<
  { ok: true; durationMs: number } & ICheckReport
> = CheckOutputSchema;
void _checkCubreElInforme;

// --- `list`: the endpoints, as data ------------------------------------------

export const ListInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IListInput = z.infer<typeof ListInputSchema>;

/**
 * What `list` returns.
 *
 * As data, not as prose: the CLI prints a table for humans, and an
 * agent parsing it with regex breaks the day a column changes.
 */
export const ListOutputSchema = z.object({
  ok: z.literal(true),
  total: z.number().int().nonnegative(),
  endpoints: z.array(
    z.object({
      method: z.string(),
      uri: z.string(),
      name: z.string(),
      folder: z.string().describe("The collection folder where it lives."),
    }),
  ),
});

export type IListOutput = z.infer<typeof ListOutputSchema>;

// --- `stats`: the shape of the collection, in numbers ------------------------

export const StatsInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IStatsInput = z.infer<typeof StatsInputSchema>;

/**
 * What `stats` returns.
 *
 * The CLI prints a table aligned with `padEnd`, which is the worst
 * thing you can hand an agent to parse: the column width depends on
 * the longest folder name, so it changes between projects.
 */
export const StatsOutputSchema = z.object({
  ok: z.literal(true),
  total: z.number().int().nonnegative().describe("Requests en la coleccion."),
  byMethod: z
    .array(
      z.object({
        method: z.string(),
        count: z.number().int().nonnegative(),
      }),
    )
    .describe("De mayor a menor, igual que se imprime."),
  zones: z
    .array(
      z.object({
        zone: z.string(),
        total: z.number().int().nonnegative(),
        byFolder: z.array(
          z.object({
            folder: z.string().describe("The first-level folder."),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
    )
    .describe(
      "Only the zones with content. A project without a zone " +
        "configuration has just one, the default.",
    ),
});

export type IStatsOutput = z.infer<typeof StatsOutputSchema>;

/**
 * The schema covers what the command returns, minus its exit code.
 *
 * `code` does not travel to the agent: a failure is answered with
 * `toolError`, which carries its own envelope. Everything else —
 * the total and the two breakdowns — must be present in full.
 */
const _statsCubreElComando: z.ZodType<{ ok: true } & Omit<IStatsOutcome, "code">> =
  StatsOutputSchema;
void _statsCubreElComando;

// --- `scan`: what discovery sees before generating anything ------------------

export const ScanInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IScanInput = z.infer<typeof ScanInputSchema>;

/**
 * What `scan` returns.
 *
 * It is the answer to "why does it not find my routes?". `summary`
 * returns the project already interpreted; this one returns the step
 * before — which scanner won, by which artefacts, and the **raw**
 * routes, before the pipeline turns them into requests. When the two
 * numbers do not match, the difference sits between these two tools.
 */
export const ScanOutputSchema = z.object({
  ok: z.literal(true),
  detected: z
    .boolean()
    .describe(
      "Distinto de `ok`: `ok` dice que el escaneo se pudo hacer, " +
        "`detected` dice si reconocio algun framework. No reconocer nada " +
        "es un resultado, no un fallo de la herramienta.",
    ),
  root: z.string().describe("The root that was scanned, already resolved."),
  framework: z.string().nullable(),
  artifacts: z
    .array(z.string())
    .describe("The files that gave the framework away: `package.json`, `server.js`…"),
  scanner: z
    .string()
    .nullable()
    .describe("The class that walks the routes. Useful when the framework matches but the routes do not."),
  validation: z
    .string()
    .nullable()
    .describe("The validation-rules provider, or null if the framework has none."),
  routes: z.array(
    z.object({
      method: z.string(),
      uri: z.string(),
      tags: z.array(z.string()),
      description: z.string().nullable(),
    }),
  ),
  durationMs: z.number().nonnegative(),
});

export type IScanOutput = z.infer<typeof ScanOutputSchema>;

/**
 * Same as for `scan`, minus `code`, and with `detected` and
 * `durationMs` added by the tool.
 *
 * `detected` is not in the command because there it is inferred from
 * `framework` being `null`; the tool makes it explicit so an agent
 * does not have to infer it.
 */
const _scanCubreElComando: z.ZodType<
  { ok: true; detected: boolean; durationMs: number } & Omit<IScanOutcome, "code">
> = ScanOutputSchema;
void _scanCubreElComando;

// --- `push`: the only operation that writes off-disk ------------------------

/**
 * `push` input.
 *
 * **Does not carry `apiKey`.** The secret does not come in through the
 * tool's input: the CLI reads it from `POSTMAN_API_KEY`, which is
 * where the host can store it without it travelling through the
 * conversation. An `apiKey` in the schema would be an invitation for
 * the agent to ask for it and repeat it.
 */
export const PushInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** Destination workspace. If missing, the user's personal one. */
    workspaceId: z.string().min(1).optional(),
    /** Framework forced, same as in `generate`. */
    framework: z.enum([...FRAMEWORK_IDS]).optional(),
    /** If `false`, uploads the collection only. Defaults to also uploading environments. */
    withEnvironments: z.boolean().optional(),
  })
  .strict();

export type IPushInput = z.infer<typeof PushInputSchema>;

/** An artefact that has reached Postman. */
export const PushedArtifactSchema = z.object({
  action: z.enum(["created", "updated"]).describe("`created` if it did not exist."),
  uid: z.string().describe("UID assigned by Postman: `<userId>-<uuid>`."),
  name: z.string(),
});

/**
 * What `push` returns.
 *
 * Not a single field with the secret, not even masked. The failure
 * arrives as `{ reason, nextAction }` **redacted**, not as the raw
 * body of the Postman response: that body can carry the request that
 * caused it, and with it the key's header.
 */
export const PushOutputSchema = z.object({
  ok: z.literal(true),
  pushed: z
    .boolean()
    .describe(
      "Distinto de `ok`: `ok` dice que la operacion se pudo intentar, " +
        "`pushed` dice si algo llego a Postman. Una clave caducada " +
        "detectada es una comprobacion que ha funcionado.",
    ),
  user: z
    .string()
    .nullable()
    .describe(
      "Usuario con el que se autentico. Es lo que permite darse cuenta de " +
        "que se ha subido al workspace equivocado, que es el error caro.",
    ),
  framework: z.string().nullable(),
  requests: z.number().int().nonnegative(),
  collection: PushedArtifactSchema.nullable(),
  environments: z.array(PushedArtifactSchema),
  durationMs: z.number().nonnegative(),
});

export type IPushOutput = z.infer<typeof PushOutputSchema>;

/**
 * The schema covers the command's result, minus `code` and `error`.
 *
 * `code` does not travel — the `toolError` envelope already
 * distinguishes the failure — and neither does `error`: when it is
 * present, the tool answers with `toolError` instead of this schema.
 */
const _pushCubreElComando: z.ZodType<
  { ok: true; pushed: boolean; durationMs: number } & Omit<
    IPushOutcome,
    "code" | "error"
  >
> = PushOutputSchema;
void _pushCubreElComando;

// --- `init`: prepare the config without parsing stdout ---------------------

/**
 * `init` input.
 *
 * `outputDir` exists because the default destination —
 * `<root>/resources/postman/examples/<name>/` — comes from when
 * this was a Laravel tool, and in other ecosystems it is not where
 * anyone would look.
 */
export const InitInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** Project name, if manifest detection does not succeed. */
    name: z.string().min(1).optional(),
    /** Where to write the configuration. Defaults to the conventional path. */
    outputDir: z.string().min(1).optional(),
  })
  .strict();

export type IInitInput = z.infer<typeof InitInputSchema>;

/**
 * What `init` returns.
 *
 * The two paths are what matters: the files it writes are full of
 * `// TODO`s on purpose, so the next step is always for someone to
 * edit them. An agent that cannot say **where** they are has not
 * finished the job, only started it.
 */
export const InitOutputSchema = z.object({
  ok: z.literal(true),
  projectName: z.string().describe("Deducido del manifiesto del ecosistema."),
  baseUrl: z.string().describe("Del `.env` del proyecto, o el valor por defecto."),
  authGuards: z
    .array(z.string())
    .describe(
      "`['token']` cuando no se reconoce ninguno: no es que no haya auth, " +
        "es que no se ha podido deducir cual.",
    ),
  routeFiles: z.array(z.string()).describe("Ficheros de rutas encontrados."),
  configPath: z.string().nullable().describe("El `config.constant.ts` escrito."),
  endpointsPath: z
    .string()
    .nullable()
    .describe("El `endpoints.constant.ts`, vacio, para overrides manuales."),
  durationMs: z.number().nonnegative(),
});

export type IInitOutput = z.infer<typeof InitOutputSchema>;

/** The schema covers the command's result, minus `code` and `error`. */
const _initCubreElComando: z.ZodType<
  { ok: true; durationMs: number } & Omit<IInitOutcome, "code" | "error">
> = InitOutputSchema;
void _initCubreElComando;
