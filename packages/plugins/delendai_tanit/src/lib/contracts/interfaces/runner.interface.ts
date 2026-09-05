/**
 * What the plugin's internal helpers return.
 *
 * They live here, not next to the function that uses them, for the
 * same reason as elsewhere in the repo: a type glued to its
 * implementation forces you to import it just to declare it, and the
 * tools end up dragging in the whole runner to type a response.
 *
 * They are not in `packages/contracts/` because the plugin is an
 * independent package that publishes on its own: it compiles with
 * real `@types/node` while the rest of the repo uses hand-written
 * ambient declarations.
 */
import { z } from "zod";

/** Result of running a script via bun. */
export interface IRunScriptResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Shape of the report emitted by `generate --json`.
 *
 * It is validated rather than trusted: the CLI is another package
 * that updates on its own, and a disappearing field has to fail
 * loudly here rather than produce an `undefined` that travels up to
 * the agent.
 *
 * The schema lives next to its type, not next to whoever parses it,
 * because the type **is inferred from it**: separating them would
 * force importing the whole runner just to declare the shape of the
 * report.
 */
export const GenerateReportSchema = z.object({
  version: z.number(),
  ok: z.boolean(),
  framework: z.string().nullable(),
  frameworks: z.array(z.string()),
  warnings: z.array(z.string()),
  projectRoot: z.string(),
  projectName: z.string(),
  collectionPath: z.string().nullable(),
  collectionId: z.string().nullable(),
  environmentPaths: z.array(z.string()),
  extraPaths: z.array(z.string()),
  requests: z.number(),
  folders: z.number(),
  auth: z
    .object({ loginEndpoint: z.string(), tokenVariable: z.string() })
    .nullable(),
  durationMs: z.number(),
});

/** Informe de `generate --json`, ya validado. */
export type IGenerateReport = z.infer<typeof GenerateReportSchema>;

/** Un endpoint esperado en el `expected.json`. */
export interface IExpectedRoute {
  readonly method: string;
  readonly uri: string;
}

/** Forma del `expected.json`. */
export interface IExpectedFixture {
  readonly framework: string;
  readonly routes: ReadonlyArray<IExpectedRoute>;
}

/** Resultado del smoke-runner. */
export interface ISmokeResult {
  readonly ok: boolean;
  readonly framework: string;
  readonly fixtureRoot: string;
  readonly actualCount: number;
  readonly expectedCount: number;
  /** Routes in `expected` but NOT in `actual`. */
  readonly missing: ReadonlyArray<IExpectedRoute>;
  /** Routes in `actual` but NOT in `expected`. */
  readonly unexpected: ReadonlyArray<{ readonly method: string; readonly uri: string }>;
  readonly durationMs: number;
}
