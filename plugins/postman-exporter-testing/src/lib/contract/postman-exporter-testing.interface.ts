/**
 * Tipos del plugin `postman-exporter-testing`.
 *
 * SOLID:
 *   - S: solo define el contrato del tool y los tipos de output.
 *   - O: añadir un step nuevo no rompe el contrato.
 *   - L: las definiciones de steps son un union cerrado.
 *   - I: input/output tipados, sin estado compartido.
 *   - D: depende de Zod (tipos derivados) y de nada más.
 */

import { z } from "zod";

// --- Opciones del plugin (leídas de mcp-vertex.config.json) -----------------

export const TestingOptionsSchema = z
  .object({
    /** Timeout per-step en ms (default 30_000). */
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
    /** Pasos a saltar (debug). */
    skipSteps: z.array(z.string()).optional(),
  })
  .strict();

export type ITestingOptions = z.infer<typeof TestingOptionsSchema>;

// --- Input del tool --------------------------------------------------------

/** Pasos disponibles. `all` ejecuta todos y devuelve roll-up. */
export const STEP_NAMES = ["typecheck", "build", "check", "all"] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const TestInputSchema = z
  .object({
    step: z.enum(STEP_NAMES).optional(),
  })
  .strict()
  .optional()
  // El tool acepta `{}` también; default = "all".
  .default({ step: "all" });

export type ITestInput = z.infer<typeof TestInputSchema>;

// --- Output del tool -------------------------------------------------------

export interface IStepResult {
  readonly name: StepName;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  /** Una línea humana del detalle (ej. "269 ↔ 269 routes"). */
  readonly detail: string;
}

export interface ITestOutput {
  readonly ok: boolean;
  readonly steps: ReadonlyArray<IStepResult>;
  readonly durationMs: number;
}
