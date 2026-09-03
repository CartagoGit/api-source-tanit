/**
 * Tipos del dominio del plugin `export-to-postman`.
 *
 * Mantienen el contrato limpio: el plugin NO depende de la
 * implementación interna del proyecto export-to-postman (que vive en
 * `../../contracts/`, `../../services/`). Solo define las entradas y
 * salidas que un agente ve al invocar los tools.
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
     * moviera a `packages/`, que es justo el motivo de que ahora haya un
     * único sitio donde está escrito y un test que lo comprueba.
     */
    cliScript: z.string().min(1).optional(),
    /**
     * Ruta absoluta al binario `bun` que el plugin usa para invocar al
     * CLI. Se lee una vez al boot (no en cada tool call) y se pasa al
     * `runner.helper` a través de `IRunnerContext.bunBin`. Si no se
     * fija, el helper cae al `MCP_VERTEX_BUN_BIN` del entorno y luego
     * a `Bun.which("bun")` / `command -v bun`.
     *
     * Esta opción existe para que los hosts AI que filtran `PATH`
     * antes de spawn (algunos clientes MCP recortan variables) puedan
     * garantizar que el plugin encuentra su binario. Sin ella el
     * plugin depende de `PATH` del shell de quien arranca el host.
     */
    mcpVertexBunBin: z.string().min(1).optional(),
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
     * La lista sale del catálogo de contratos, igual que en `test`: una
     * lista escrita a mano rechazaría el framework número veinte el día
     * que se añada. Antes salía de `frameworks/index`, que para leer
     * veintiún nombres arrastraba los veintiún scanners.
     */
    framework: z.enum([...FRAMEWORK_IDS]).optional(),
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
 * Salud de la documentación del proyecto, en porcentajes `0..100`.
 *
 * Espejo zod de `IProjectHealth` (contratos). Cada campo responde "de
 * cuántos endpoints la colección va a llevar esta pieza": con ellos un
 * agente ve si la API está bien documentada **antes** de generar, sin
 * abrir la colección para contarlo a mano.
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
      // La lista NO se escribe a mano: sale del catálogo de contratos.
      // Antes era un `enum` con doce nombres, y al añadir el trece el
      // plugin lo rechazaba como input inválido — la misma clase de
      // lista paralela que hizo que `summary` divergiera de `generate`.
      .enum([...FRAMEWORK_IDS])
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
  // f00010 S3: las señales que motivaron la elección del framework. La
  // UI las pinta como tarjetas; el agente las puede reusar para
  // responder "¿por qué Laravel?" sin tener que re-escanear.
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
  // f00010 S2: la salud de la documentación, en porcentajes. Sobre los
  // specs finales (los mismos que alimentaría `generate`), así que lo
  // que dice el health es lo que la colección va a llevar.
  health: ProjectHealthSchema.describe(
    "Salud de la documentación, en porcentajes 0..100. 0 en todo con cero endpoints.",
  ),
});

export type ISummaryOutput = z.infer<typeof SummaryOutputSchema>;

/**
 * El esquema tiene que cubrir el contrato **entero**.
 *
 * Esto no es una comprobación decorativa: es la que impide que vuelva a
 * pasar lo que ya pasó. `SummaryOutputSchema` declaraba 6 campos
 * mientras el handler hacía `toolJson({ ok: true, ...summary })` y
 * soltaba los dieciocho. El contrato escrito y el comportamiento
 * llevaban tiempo sin coincidir y nadie podía notarlo, porque no había
 * nada que los confrontara.
 *
 * Con esta línea, añadir un campo a `IProjectSummary` y olvidarse del
 * esquema **no compila**. Los campos de más sí se permiten —el tool
 * añade `ok`— porque lo que se comprueba es que no falte ninguno. Es
 * la que cazó `health` el día que `IProjectSummary` lo estrenó: sin
 * ella, `SummaryOutputSchema` habría seguido describiendo el resumen
 * de hace dos slices.
 */
const _summaryCubreElContrato: z.ZodType<{ ok: true } & IProjectSummary> =
  SummaryOutputSchema;
void _summaryCubreElContrato;

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

/**
 * Igual que en `summary`: el esquema tiene que cubrir el informe entero.
 *
 * `ICheckReport` es lo que produce el comando; el tool le añade `ok` y
 * `durationMs`. Si mañana el informe gana un campo y el esquema no, esto
 * deja de compilar en vez de devolver una salida que el contrato del
 * tool no describe.
 */
const _checkCubreElInforme: z.ZodType<
  { ok: true; durationMs: number } & ICheckReport
> = CheckOutputSchema;
void _checkCubreElInforme;

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

// --- `stats`: la forma de la coleccion, en numeros --------------------------

export const StatsInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IStatsInput = z.infer<typeof StatsInputSchema>;

/**
 * Lo que devuelve `stats`.
 *
 * El CLI imprime una tabla alineada con `padEnd`, que es lo peor que se
 * le puede dar a un agente para parsear: el ancho de columna depende del
 * nombre de carpeta mas largo, asi que cambia entre proyectos.
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
            folder: z.string().describe("La carpeta de primer nivel."),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
    )
    .describe(
      "Solo las zonas con contenido. Un proyecto sin configuracion de " +
        "zonas tiene una sola, la de por defecto.",
    ),
});

export type IStatsOutput = z.infer<typeof StatsOutputSchema>;

/**
 * El esquema cubre lo que devuelve el comando, menos su codigo de salida.
 *
 * `code` no viaja al agente: un fallo se responde con `toolError`, que
 * lleva su propio sobre. Lo demas —total y los dos desgloses— tiene que
 * estar entero.
 */
const _statsCubreElComando: z.ZodType<{ ok: true } & Omit<IStatsOutcome, "code">> =
  StatsOutputSchema;
void _statsCubreElComando;

// --- `scan`: que ve el discovery antes de generar nada ----------------------

export const ScanInputSchema = z
  .object({ projectRoot: z.string().min(1).optional() })
  .strict();

export type IScanInput = z.infer<typeof ScanInputSchema>;

/**
 * Lo que devuelve `scan`.
 *
 * Es la respuesta a «¿por que no encuentra mis rutas?». `summary` da el
 * proyecto ya interpretado; esto da el paso anterior — que scanner gano,
 * por que artefactos, y las rutas **crudas**, antes de que el pipeline
 * las convierta en requests. Cuando los dos numeros no cuadran, la
 * diferencia esta entre estos dos tools.
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
  root: z.string().describe("La raiz que se escaneo, ya resuelta."),
  framework: z.string().nullable(),
  artifacts: z
    .array(z.string())
    .describe("Los ficheros que delataron al framework: `package.json`, `server.js`…"),
  scanner: z
    .string()
    .nullable()
    .describe("La clase que recorre las rutas. Util cuando el framework acierta y las rutas no."),
  validation: z
    .string()
    .nullable()
    .describe("El proveedor de reglas de validacion, o null si el framework no tiene."),
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
 * Lo mismo para `scan`, menos `code`, y con `detected` y `durationMs`
 * que anade el tool.
 *
 * `detected` no esta en el comando porque alli se deduce de que
 * `framework` sea `null`; el tool lo hace explicito para que un agente
 * no tenga que inferirlo.
 */
const _scanCubreElComando: z.ZodType<
  { ok: true; detected: boolean; durationMs: number } & Omit<IScanOutcome, "code">
> = ScanOutputSchema;
void _scanCubreElComando;

// --- `push`: la unica operacion que escribe fuera del disco -----------------

/**
 * Entrada de `push`.
 *
 * **No lleva `apiKey`.** El secreto no entra por el input del tool: lo
 * lee el CLI de `POSTMAN_API_KEY`, que es donde el host puede guardarlo
 * sin que viaje por la conversacion. Un `apiKey` en el esquema seria una
 * invitacion a que el agente lo pida y lo repita.
 */
export const PushInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** Workspace destino. Si falta, el personal por defecto. */
    workspaceId: z.string().min(1).optional(),
    /** Framework a la fuerza, igual que en `generate`. */
    framework: z.enum([...FRAMEWORK_IDS]).optional(),
    /** Si es `false`, sube solo la coleccion. Por defecto sube tambien los entornos. */
    withEnvironments: z.boolean().optional(),
  })
  .strict();

export type IPushInput = z.infer<typeof PushInputSchema>;

/** Un artefacto que ha llegado a Postman. */
export const PushedArtifactSchema = z.object({
  action: z.enum(["created", "updated"]).describe("`created` si no existia."),
  uid: z.string().describe("UID que asigna Postman: `<userId>-<uuid>`."),
  name: z.string(),
});

/**
 * Lo que devuelve `push`.
 *
 * Ni un campo con el secreto, ni enmascarado. El fallo llega como
 * `{ reason, nextAction }` **redactados**, no como el cuerpo crudo de la
 * respuesta de Postman: ese cuerpo puede traer la peticion que lo causo,
 * y con ella la cabecera de la clave.
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
 * El esquema cubre el resultado del comando, menos `code` y `error`.
 *
 * `code` no viaja —el sobre de `toolError` ya distingue el fallo— y
 * `error` tampoco: cuando lo hay, el tool responde con `toolError` en
 * vez de con este esquema.
 */
const _pushCubreElComando: z.ZodType<
  { ok: true; pushed: boolean; durationMs: number } & Omit<
    IPushOutcome,
    "code" | "error"
  >
> = PushOutputSchema;
void _pushCubreElComando;

// --- `init`: preparar la configuracion sin parsear stdout -------------------

/**
 * Entrada de `init`.
 *
 * `outputDir` existe porque el destino por defecto —
 * `<raiz>/resources/postman/examples/<nombre>/` — viene de cuando esto
 * era una herramienta de Laravel, y en otros ecosistemas no es donde
 * nadie lo buscaria.
 */
export const InitInputSchema = z
  .object({
    projectRoot: z.string().min(1).optional(),
    /** Nombre del proyecto, si la deteccion por manifiesto no acierta. */
    name: z.string().min(1).optional(),
    /** Donde escribir la configuracion. Por defecto, la ruta convencional. */
    outputDir: z.string().min(1).optional(),
  })
  .strict();

export type IInitInput = z.infer<typeof InitInputSchema>;

/**
 * Lo que devuelve `init`.
 *
 * Las dos rutas son lo importante: los ficheros que escribe estan llenos
 * de `// TODO` a proposito, asi que el siguiente paso siempre es que
 * alguien los edite. Un agente que no pueda decir **donde** estan no ha
 * terminado el trabajo, solo lo ha empezado.
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

/** El esquema cubre el resultado del comando, menos `code` y `error`. */
const _initCubreElComando: z.ZodType<
  { ok: true; durationMs: number } & Omit<IInitOutcome, "code" | "error">
> = InitOutputSchema;
void _initCubreElComando;
