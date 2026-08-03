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
     * Ruta por defecto al proyecto Laravel host cuando el agente no
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

// --- Outputs de los tools (estructura resumida) ------------------------------

export interface IGenerateOutput {
  readonly collectionPath: string;
  readonly environmentPaths: ReadonlyArray<string>;
  readonly requests: number;
  readonly folders: number;
  readonly variables: number;
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
