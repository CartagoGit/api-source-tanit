/**
 * Lo que devuelven los ayudantes internos del plugin.
 *
 * Viven aquí y no junto a la función que los usa por lo mismo que en el
 * resto del repositorio: un tipo pegado a su implementación obliga a
 * importarla para declararlo, y los tools acaban arrastrando el runner
 * entero solo para tipar una respuesta.
 *
 * No están en `packages/contracts/` porque el plugin es un paquete
 * independiente que se publica solo: compila con `@types/node` real
 * mientras el resto del repo usa declaraciones ambient escritas a mano.
 */
import { z } from "zod";

/** Resultado de ejecutar un script via bun. */
export interface IRunScriptResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Forma del informe que emite `generate --json`.
 *
 * Se valida en vez de confiarse: el CLI es otro paquete que se
 * actualiza por su cuenta, y un campo que desaparece tiene que dar un
 * error claro aquí y no un `undefined` que viaje hasta el agente.
 *
 * El esquema vive con su tipo, y no al lado de quien lo parsea, porque
 * el tipo **se infiere de él**: separarlos obligaría a importar el
 * runner entero para declarar la forma del informe.
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
  /** Solo en rutas que están en `expected` pero NO en `actual`. */
  readonly missing: ReadonlyArray<IExpectedRoute>;
  /** Solo en rutas que están en `actual` pero NO en `expected`. */
  readonly unexpected: ReadonlyArray<{ readonly method: string; readonly uri: string }>;
  readonly durationMs: number;
}
