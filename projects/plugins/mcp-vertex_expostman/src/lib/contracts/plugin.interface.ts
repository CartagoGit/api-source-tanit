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

// --- Outputs de los tools (estructura resumida) ------------------------------

export interface IGenerateOutput {
  /** Framework detectado, o `null` si no se reconoció ninguno. */
  readonly framework: string | null;
  /** Más de uno = proyecto híbrido; se han escaneado y fusionado todos. */
  readonly frameworks: ReadonlyArray<string>;
  /** Avisos accionables. No son errores: la colección existe igual. */
  readonly warnings: ReadonlyArray<string>;
  /** `null` solo si no se llegó a escribir la colección. */
  readonly collectionPath: string | null;
  /** `_postman_id`: lo que hace que reimportar actualice en vez de duplicar. */
  readonly collectionId: string | null;
  readonly environmentPaths: ReadonlyArray<string>;
  /**
   * Ficheros de formatos distintos de Postman.
   *
   * Vacío cuando no se pidió ninguno. Van aparte de `environmentPaths`
   * porque no son environments: son la misma API en otro idioma.
   */
  readonly extraPaths: ReadonlyArray<string>;
  readonly requests: number;
  readonly folders: number;
  /** `null` si el proyecto no tiene endpoint de login. */
  readonly auth: {
    readonly loginEndpoint: string;
    readonly tokenVariable: string;
  } | null;
  readonly durationMs: number;
}

export interface IValidateOutput {
  readonly ok: boolean;
  readonly routesInSource: number;
  readonly requestsInCollection: number;
  readonly issues: ReadonlyArray<{
    readonly severity: "error" | "warning";
    readonly message: string;
  }>;
  readonly durationMs: number;
}

export interface ISummaryOutput {
  readonly projectName: string;
  readonly baseUrl: string;
  readonly routesInCode: number;
  readonly formRequestsResolved: number;
  readonly zeroConfig: boolean;
  readonly configPath: string;
}

/**
 * Resultado de un step del tool `test`. Cada step es la ejecución de
 * un sub-comando (`typecheck`, `test e2e`, `smoke:<framework>`).
 */
export interface ITestStep {
  readonly name: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  /** Resumen corto (count de tests, typecheck pass, etc.). */
  readonly summary?: string;
  /** Si falló, el primer fragmento del stderr/stdout relevante. */
  readonly detail?: string;
}

export interface ITestOutput {
  readonly ok: boolean;
  readonly steps: ReadonlyArray<ITestStep>;
  readonly durationMs: number;
  /**
   * Si el input pidió `framework`, nombre del framework para el que se
   * corrió el smoke. `null` cuando solo se corrió la suite genérica.
   */
  readonly framework: string | null;
}
