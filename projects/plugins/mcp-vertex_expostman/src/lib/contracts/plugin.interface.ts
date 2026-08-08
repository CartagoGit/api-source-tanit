/**
 * Tipos del dominio del plugin `export-to-postman`.
 *
 * Mantienen el contrato limpio: el plugin NO depende de la
 * implementación interna del proyecto export-to-postman (que vive en
 * `../../contracts/`, `../../services/`). Solo define las entradas y
 * salidas que un agente ve al invocar los tools.
 */

import { z } from "zod";

import { SUPPORTED_FRAMEWORKS } from "../../../../../frameworks/index";
import { supportedFormats } from "../../../../../core/exporters/export-registry.service";

// --- Opciones del plugin (leídas de mcp-vertex.config.json) ------------------

export const ExportToPostmanOptionsSchema = z
  .object({
    /**
     * Ruta por defecto al proyecto host cuando el agente no
     * la pasa explícitamente. La cadena de fallback completa es:
     *   `args.projectRoot ?? defaultProjectRoot ?? workspaceRoot`.
     * Si ninguno resuelve, el tool devuelve un error claro.
     */
    defaultProjectRoot: z.string().min(1).optional(),
    /**
     * Ruta al script CLI del paquete export-to-postman.
     *
     * El valor por defecto vive en `cli-path.constant.ts`, no aquí: esta
     * frase decía `scripts/cli.script.ts` mucho después de que el CLI se
     * moviera a `projects/`, que es justo el motivo de que ahora haya un
     * único sitio donde está escrito y un test que lo comprueba.
     */
    cliScript: z.string().min(1).optional(),
  })
  .strict();

export type IExportToPostmanOptions = z.infer<
  typeof ExportToPostmanOptionsSchema
>;

// --- Inputs de los tools ----------------------------------------------------

/**
 * `projectRoot` ahora es OPCIONAL en los 3 tools.
 * El fallback canónico en runtime es:
 *   `args.projectRoot ?? ctx.options.defaultProjectRoot ?? ctx.workspace`.
 * Decidimos hacerlo en el handler (no en zod) para que el schema
 * siga siendo declarativo y el comportamiento sea explícito.
 */
export const GenerateInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    outputDir: z.string().min(1).optional(),
    envs: z.array(z.string().min(1)).optional(),
    openAfter: z.boolean().optional(),
    /**
     * Framework a la fuerza, saltándose la autodetección.
     *
     * Es la salida para los proyectos donde la detección por manifiesto
     * NO PUEDE acertar: un monorepo cuyo `package.json` está en la raíz,
     * una dependencia con alias, un manifiesto que se genera en el
     * build. Sin esto, un agente que recibe "no se ha detectado nada" no
     * tiene forma de aprovechar que la persona a la que asiste sí sabe
     * de qué es su API.
     *
     * La lista sale del registro de scanners, igual que en `test`: una
     * lista escrita a mano rechazaría el framework número veinte el día
     * que se añada.
     */
    framework: z.enum(SUPPORTED_FRAMEWORKS as [string, ...string[]]).optional(),
    /**
     * Formatos de salida. Por defecto solo Postman.
     *
     * Existen seis y el plugin solo llegaba al primero, así que un agente
     * al que le piden "sácame el OpenAPI de esta API" no tenía forma de
     * hacerlo aunque el CLI supiera.
     *
     * La lista sale del registro de exportadores, igual que `framework`
     * sale del de scanners: una escrita a mano rechazaría el séptimo el
     * día que se añada.
     */
    formats: z
      .array(z.enum(supportedFormats() as [string, ...string[]]))
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
 * Inputs del tool `test`. Por defecto corre la suite e2e completa del
 * propio paquete export-to-postman (ya en workspace). Si se pasa
 * `framework`, corre un smoke test contra el fixture correspondiente
 * (`tests/fixtures/<framework>-comprehensive/`).
 */
export const TestInputSchema = z
  .object({
    /**
     * Si se da, corre un smoke test contra el fixture de ese framework.
     * Los valores válidos son los del registro de scanners, así que
     * un framework nuevo se acepta sin tocar este fichero.
     */
    framework: z
      // La lista NO se escribe a mano: sale del registro de scanners.
      // Antes era un `enum` con doce nombres, y al añadir el trece el
      // plugin lo rechazaba como input inválido — la misma clase de
      // lista paralela que hizo que `summary` divergiera de `generate`.
      .enum(SUPPORTED_FRAMEWORKS as [string, ...string[]])
      .optional(),
    /**
     * Si es `true`, corre `bun run typecheck` además de `bun test`.
     * Default: true.
     */
    withTypecheck: z.boolean().optional(),
  })
  .strict();

export type ITestInput = z.infer<typeof TestInputSchema>;

// --- Outputs de los tools ----------------------------------------------------

/**
 * Los cuatro tools declaran `outputSchema`, y no es un adorno.
 *
 * El invariante universal §6 —que `AGENT-BOOTSTRAP.md` copia por
 * referencia y §3.2 repite— dice que todo tool público lo declara.
 * Ninguno lo hacía. Un agente que llamaba a `expostman_generate` recibía
 * una salida sin contrato: no podía validar la respuesta ni saber qué
 * campos existen sin ejecutarla y mirar lo que salía. Y esta es la
 * superficie **pública** del proyecto hacia otros agentes, que es
 * justamente donde un contrato importa más.
 *
 * Los esquemas describen el **éxito**, con `ok: z.literal(true)`. El
 * error no va aquí: `toolError` tiene su propio sobre universal
 * (`{ ok: false, error: { reason, nextAction? } }`) y marca la respuesta
 * con `isError`, así que un cliente lo distingue sin que cada tool
 * repita esa forma. Es el mismo reparto que usan los tools del host.
 *
 * Los tipos se derivan de los esquemas con `z.infer`, no se escriben dos
 * veces: una interfaz a mano al lado de un esquema es dos fuentes de
 * verdad que se separan a la primera.
 */

/** Lo que devuelve `generate` cuando la colección se ha escrito. */
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

/** Lo que devuelve `validate` sobre una colección ya escrita. */
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
 * Lo que devuelve `summary`: el proyecto visto desde el código, sin
 * generar nada.
 *
 * Describe el resumen **entero**, que es lo que el tool devuelve de
 * verdad. La interfaz anterior declaraba seis campos mientras el handler
 * hacía `toolJson({ ok: true, ...summary })` y soltaba los dieciocho:
 * el contrato escrito y el comportamiento llevaban tiempo sin coincidir,
 * y nadie podía notarlo porque no había esquema que los confrontara.
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
});

export type ISummaryOutput = z.infer<typeof SummaryOutputSchema>;

/** Un paso de `test`: la ejecución de un sub-comando. */
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


// --- `check`: la pregunta que un agente mas quiere hacer ---------------------

/**
 * Entrada de `check`.
 *
 * Es el tool que faltaba, y el mas llamativo de los que faltaban:
 * responde «¿se ha desincronizado mi coleccion del codigo?», que es
 * justo lo que un agente quiere saber antes de tocar nada. Estaba en el
 * CLI desde el principio y no se exponia.
 */
export const CheckInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** La coleccion a comparar. Si falta, la que corresponda al proyecto. */
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

// --- `list`: los endpoints, en datos ----------------------------------------

export const ListInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IListInput = z.infer<typeof ListInputSchema>;

/**
 * Lo que devuelve `list`.
 *
 * En datos y no en prosa: el CLI imprime una tabla para leer, y un
 * agente que la parsee con regex se rompe el dia que cambie una
 * columna.
 */
export const ListOutputSchema = z.object({
  ok: z.literal(true),
  total: z.number().int().nonnegative(),
  endpoints: z.array(
    z.object({
      method: z.string(),
      uri: z.string(),
      name: z.string(),
      folder: z.string().describe("La carpeta de la coleccion donde vive."),
    }),
  ),
});

export type IListOutput = z.infer<typeof ListOutputSchema>;
