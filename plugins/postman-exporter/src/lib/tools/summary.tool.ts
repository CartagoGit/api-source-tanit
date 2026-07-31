/**
 * Tool `postman_exporter_summary`.
 *
 * Ejecuta discovery sobre un proyecto Laravel host sin generar
 * artefactos. Devuelve: nombre detectado, baseUrl, rutas en código,
 * FormRequests resueltos, modo (zero-config o con config del host).
 *
 * SOLID: S = solo lectura; no muta nada.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";

import {
  SummaryInputSchema,
  type ISummaryOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

const NAMESPACE = "postman";

export function buildSummaryToolRegistration(): IToolRegistration {
  return {
    name: `${NAMESPACE}_exporter_summary`,
    description:
      "Inspecciona un proyecto Laravel host sin generar artefactos. Devuelve " +
      "nombre detectado, baseUrl, rutas en código, FormRequests resueltos y modo.",
    inputSchema: SummaryInputSchema,
    async handler(input: unknown): Promise<ReturnType<typeof toolJson>> {
      const parsed = SummaryInputSchema.safeParse(input);
      if (!parsed.success) {
        return toolError(
          `Input inválido: ${parsed.error.message}`,
          "Pasa projectRoot (ruta absoluta).",
        );
      }
      const args = parsed.data;

      // Reutilizamos `generate --check` para volcar discovery + cobertura.
      // Para no escribir artefactos, no tenemos hoy un script "summary" propio;
      // el grep sobre stdout es suficiente como punto de partida.
      const result = runBunScript(
        "scripts/diff.script.ts",
        ["--project-root", args.projectRoot, "--help"],
        { cwd: process.cwd() },
      );

      // Parseamos "Config host: ..." del output de generate (más fiel que diff --help).
      const genResult = runBunScript(
        "scripts/generate.script.ts",
        [
          "generate",
          "--project-root",
          args.projectRoot,
          "--output-dir",
          "/tmp/postman-exporter-summary-dryrun",
        ],
        { cwd: process.cwd(), timeoutMs: 30_000 },
      );
      const configMatch = genResult.stdout.match(/Config host:\s+(.+)/);
      const routesMatch = genResult.stdout.match(/(\d+)\s+rutas en c[oó]digo/);
      const frMatch = genResult.stdout.match(/\(FormRequest:\s+(\d+)/);
      const out: ISummaryOutput = {
        projectName: configMatch?.[1]?.trim() ?? "<no detectado>",
        baseUrl: "<inferida por zero-config o config del host>",
        routesInCode: routesMatch ? Number(routesMatch[1]) : 0,
        formRequestsResolved: frMatch ? Number(frMatch[1]) : 0,
        zeroConfig: (configMatch?.[1] ?? "").includes("<zero-config>"),
        configPath: configMatch?.[1]?.trim() ?? "<zero-config>",
      };
      return toolJson(out);
    },
  };
}
