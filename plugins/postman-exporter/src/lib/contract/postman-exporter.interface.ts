/**
 * Tipos del dominio del plugin `postman-exporter`.
 *
 * Mantienen el contrato limpio: el plugin NO depende de la
 * implementación interna del proyecto postman-exporter (que vive en
 * `../../contract/`, `../../service/`). Solo define las entradas y
 * salidas que un agente ve al invocar los tools.
 */

import { z } from "zod";

// --- Opciones del plugin (leídas de mcp-vertex.config.json) ------------------

export const PostmanExporterOptionsSchema = z
  .object({
    /**
     * Ruta por defecto al proyecto host cuando el agente no
     * la pasa explícitamente. La cadena de fallback completa es:
     *   `args.projectRoot ?? defaultProjectRoot ?? workspaceRoot`.
     * Si ninguno resuelve, el tool devuelve un error claro.
     */
    defaultProjectRoot: z.string().min(1).optional(),
    /**
     * Ruta al script CLI del paquete postman-exporter. Por defecto
     * `${workspaceFolder}/scripts/cli.script.ts`.
     */
    cliScript: z.string().min(1).optional(),
  })
  .strict();

export type IPostmanExporterOptions = z.infer<
  typeof PostmanExporterOptionsSchema
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
 * propio paquete postman-exporter (ya en workspace). Si se pasa
 * `framework`, corre un smoke test contra el fixture correspondiente
 * (`tests/fixtures/<framework>-comprehensive/`).
 */
export const TestInputSchema = z
  .object({
    /**
     * Si se da, corre un smoke test contra el fixture de ese framework.
     * Valores aceptados: "laravel" | "symfony" | "express" | "fastapi" |
     * "nestjs" | "django" | "openapi" | "flask" | "nextjs" | "gin" |
     * "springboot" | "aspnet".
     */
    framework: z
      .enum([
        "laravel",
        "symfony",
        "express",
        "fastapi",
        "nestjs",
        "django",
        "openapi",
        "flask",
        "nextjs",
        "gin",
        "springboot",
        "aspnet",
      ])
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
  /** `null` solo si no se llegó a escribir la colección. */
  readonly collectionPath: string | null;
  /** `_postman_id`: lo que hace que reimportar actualice en vez de duplicar. */
  readonly collectionId: string | null;
  readonly environmentPaths: ReadonlyArray<string>;
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
