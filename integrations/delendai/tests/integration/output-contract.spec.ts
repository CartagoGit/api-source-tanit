/**
 * What each tool **returns** versus what each tool **declares**.
 *
 * The eight tools publish an `outputSchema`. Until now that was
 * text in a file: `lint:mcp-surface` checked that it was present,
 * and each tool's specs checked hand-picked individual fields.
 * Nobody confronted the actual output with the full declaration.
 *
 * And that gap was already paid for. `SummaryOutputSchema` declared
 * six fields while the handler did `toolJson({ ok: true, ...summary })`
 * and returned all eighteen. The project's public contract toward
 * other agents had been lying for a while, and nothing could notice.
 *
 * Both directions are checked here, since they are different bugs:
 *
 *   · **Missing fields** → an agent trusting the schema reads
 *     `undefined` where the contract promised a value. `safeParse`
 *     catches it.
 *   · **Extra fields** → the tool returns data its contract does not
 *     describe, so nobody can validate it or even know it exists.
 *     Zod silently drops it, so the keys have to be compared by
 *     hand.
 *
 * The schema is taken from the **tool's registration** (`captureTool`),
 * not from an import of the schema module. Comparing against a copy
 * written into the test would prove nothing: the two copies would
 * drift together.
 *
 * ## Why `test` is not here
 *
 * `tanit_test` runs the project's test suite. Invoking it from inside
 * the suite is a fork bomb: each run would launch another. Its
 * contract is covered by `test.tool.spec.ts` with doubles.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ZodObject, ZodRawShape, ZodType } from "zod";

import { buildCheckToolRegistration } from "../../src/lib/tools/check.tool";
import { buildGenerateToolRegistration } from "../../src/lib/tools/generate.tool";
import { buildListToolRegistration } from "../../src/lib/tools/list.tool";
import { buildScanToolRegistration } from "../../src/lib/tools/scan.tool";
import { buildStatsToolRegistration } from "../../src/lib/tools/stats.tool";
import { buildSummaryToolRegistration } from "../../src/lib/tools/summary.tool";
import { buildValidateToolRegistration } from "../../src/lib/tools/validate.tool";
import { captureTool, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let proyecto = "";
let coleccion = "";

/** The real CLI, by subprocess: vitest runs in Node workers. */
function cli(args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(RAIZ, "packages/cli/cli.script.ts"), ...args],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "contrato-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "tanit"), { recursive: true, force: true });
  await cli(["generate", "--project-root", proyecto]);
  coleccion = join(
    proyecto,
    "tanit",
    "sample-express.postman_collection.json",
  );
}, 240_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** The seven tools that can be invoked without outsized side effects. */
const TOOLS = [
  { id: "scan", build: buildScanToolRegistration, input: () => ({ projectRoot: proyecto }) },
  { id: "summary", build: buildSummaryToolRegistration, input: () => ({ projectRoot: proyecto }) },
  { id: "check", build: buildCheckToolRegistration, input: () => ({ projectRoot: proyecto }) },
  { id: "list", build: buildListToolRegistration, input: () => ({ projectRoot: proyecto }) },
  { id: "stats", build: buildStatsToolRegistration, input: () => ({ projectRoot: proyecto }) },
  {
    id: "validate",
    build: buildValidateToolRegistration,
    input: () => ({ projectRoot: proyecto, collectionPath: coleccion }),
  },
  {
    id: "generate",
    build: buildGenerateToolRegistration,
    input: () => ({ projectRoot: proyecto }),
  },
] as const;

/** Invokes a tool and returns its output along with the schema it declared. */
async function invocar(
  build: (ctx: ReturnType<typeof makeContext>) => Parameters<typeof captureTool>[0],
  input: Record<string, unknown>,
): Promise<{ salida: Record<string, unknown>; esquema: ZodType; nombre: string }> {
  const tool = await captureTool(build(makeContext({ workspaceRoot: RAIZ })));
  const resultado = await tool.handler(input);
  const salida = JSON.parse(resultado.content[0]?.text ?? "{}") as Record<
    string,
    unknown
  >;
  return { salida, esquema: tool.outputSchema as ZodType, nombre: tool.name };
}

describe("cada tool devuelve lo que declara", () => {
  test.for(TOOLS)(
    "$id: la salida valida contra su propio outputSchema",
    { timeout: 240_000 },
    async ({ build, input }) => {
      const { salida, esquema, nombre } = await invocar(build, input());

      const parsed = esquema.safeParse(salida);
      expect(
        parsed.success,
        `${nombre} devolvió algo que su esquema no acepta:\n` +
          (parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)),
      ).toBe(true);
    },
  );

  /**
   * The other side. Zod silently drops the keys it does not know,
   * so an extra field passes `safeParse` quietly — and that is a
   * field no agent can know exists.
   */
  test.for(TOOLS)(
    "$id: does not return a single field its schema does not declare",
    { timeout: 240_000 },
    async ({ build, input }) => {
      const { salida, esquema, nombre } = await invocar(build, input());

      // `.shape` is specific to `ZodObject`, and the test below checks
      // that all schemas are. Narrowing happens here instead of via a
      // type escape.
      const declaradas = Object.keys((esquema as ZodObject<ZodRawShape>).shape);
      const sobran = Object.keys(salida).filter((k) => !declaradas.includes(k));

      expect(sobran, `${nombre} returns fields without declaring them`).toEqual([]);
    },
  );

  /**
   * An `outputSchema` that is not an object describes nothing: an
   * agent cannot know which fields to read. It is checked separately
   * because the test above uses `.shape`, and without this a
   * degenerate schema would break it with an access error rather
   * than a diagnostic.
   */
  test.for(TOOLS)("$id: its outputSchema is an object with a shape", async ({ build }) => {
    const tool = await captureTool(build(makeContext({ workspaceRoot: RAIZ })));
    const shape = (tool.outputSchema as Partial<ZodObject<ZodRawShape>>).shape;
    expect(shape, `${tool.name} does not declare an object shape`).toBeDefined();
    expect(Object.keys(shape ?? {}).length).toBeGreaterThan(0);
  });

  /**
   * All of them promise `ok: true` on the happy path. The error
   * travels through `toolError`'s universal envelope, with
   * `isError`, so a client distinguishes the two cases without each
   * tool inventing its own shape.
   */
  test.for(TOOLS)(
    "$id: el camino feliz responde ok",
    { timeout: 240_000 },
    async ({ build, input }) => {
      const { salida, nombre } = await invocar(build, input());
      expect(salida["ok"], `${nombre} did not return ok:true`).toBe(true);
    },
  );
});
