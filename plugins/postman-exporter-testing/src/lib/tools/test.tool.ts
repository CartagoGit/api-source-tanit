/**
 * Tool `postman_exporter_test`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";
import z from "zod";

import {
  TestInputSchema,
  type ITestOutput,
  type StepName,
} from "../contract/postman-exporter-testing.interface";
import {
  runBuild,
  runCheck,
  runTypecheck,
  stepsFor,
} from "../helpers/steps.helper";

const NAMESPACE = "postman";

const OUTPUT = z
  .object({
    ok: z.boolean(),
    steps: z.array(
      z.object({
        name: z.string(),
        ok: z.boolean(),
        exitCode: z.number().int(),
        durationMs: z.number().int().min(0),
        detail: z.string(),
      }),
    ),
    durationMs: z.number().int().min(0),
  })
  .strict();

export const buildTestToolRegistration = (
  workspaceRoot: string,
): IToolRegistration => ({
  id: `${NAMESPACE}_exporter_test`,
  tags: ["postman", "health", "validator", "effects"],
  summary:
    "Valida la salud del paquete postman-exporter ejecutando los gates (typecheck, build, check).",
  register: async (server) => {
    server.registerTool(
      `${NAMESPACE}_exporter_test`,
      {
        description:
          "Valida la salud del paquete postman-exporter ejecutando los gates " +
          "(typecheck, build, check). Devuelve un roll-up estructurado con " +
          "tiempo por step y exit-code. NO toca ningún proyecto host.",
        inputSchema: TestInputSchema,
        outputSchema: OUTPUT,
      },
      async (args: { step?: StepName }) => {
        const step = args.step ?? ("all" as StepName);
        const timeoutMs = 30_000;
        const stepNames = stepsFor(step);
        const start = Date.now();
        const stepResults = [];
        let abort = false;
        for (const name of stepNames) {
          if (abort) break;
          let result;
          switch (name) {
            case "typecheck":
              result = { name, ...runTypecheck(workspaceRoot, timeoutMs) };
              break;
            case "build":
              result = { name, ...runBuild(workspaceRoot, timeoutMs) };
              break;
            case "check":
              result = { name, ...runCheck(workspaceRoot, timeoutMs) };
              break;
            case "all":
              continue;
          }
          stepResults.push(result);
          if (!result.ok && step !== "all") abort = true;
        }
        const ok = stepResults.every((s) => s.ok);
        const out: ITestOutput = {
          ok,
          steps: stepResults,
          durationMs: Date.now() - start,
        };
        return toolJson(out);
      },
    );
  },
});
