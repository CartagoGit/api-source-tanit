/**
 * Lo que cada tool **devuelve** contra lo que cada tool **declara**.
 *
 * Los ocho tools publican un `outputSchema`. Hasta aquí eso era texto en
 * un fichero: `lint:mcp-surface` comprobaba que estuviera, y los specs
 * de cada tool comprobaban campos sueltos elegidos a mano. Nadie
 * confrontaba la salida real con la declaración completa.
 *
 * Y esa distancia ya se pagó. `SummaryOutputSchema` declaraba seis
 * campos mientras el handler hacía `toolJson({ ok: true, ...summary })`
 * y soltaba los dieciocho. El contrato público del proyecto hacia otros
 * agentes llevaba tiempo mintiendo, y no había nada que pudiera notarlo.
 *
 * Aquí se comprueban las dos direcciones, que son fallos distintos:
 *
 *   · **Faltan campos** → un agente que se fía del esquema lee
 *     `undefined` donde el contrato prometía un valor. Lo caza el
 *     `safeParse`.
 *   · **Sobran campos** → el tool devuelve datos que su contrato no
 *     describe, así que nadie puede validarlos ni saber que existen. Zod
 *     los descarta en silencio, así que hay que comparar las claves a
 *     mano.
 *
 * El esquema se saca del **registro del tool** (`captureTool`), no de un
 * import del módulo de esquemas. Comparar contra una copia escrita en el
 * test no comprobaría nada: las dos copias se separarían juntas.
 *
 * ## Por qué `test` no está
 *
 * `tanit_test` ejecuta la suite del proyecto. Invocarlo desde dentro
 * de la suite es una bomba de bifurcación: cada ejecución lanzaría otra.
 * Su contrato lo cubre `test.tool.spec.ts` con dobles.
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

/** El CLI de verdad, por subproceso: vitest corre en workers de Node. */
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

/** Los siete tools que se pueden invocar sin efectos desmedidos. */
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

/** Invoca un tool y devuelve su salida junto al esquema que declaró. */
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
   * EL otro lado. Zod descarta las claves que no conoce sin decir nada,
   * así que un campo de más pasa el `safeParse` tan tranquilo — y es un
   * campo que ningún agente puede saber que existe.
   */
  test.for(TOOLS)(
    "$id: no devuelve ni un campo que su esquema no declare",
    { timeout: 240_000 },
    async ({ build, input }) => {
      const { salida, esquema, nombre } = await invocar(build, input());

      // `.shape` es propio de `ZodObject`, y el test de abajo comprueba
      // que todos los esquemas lo son. Se estrecha aquí en vez de con un
      // escape de tipo.
      const declaradas = Object.keys((esquema as ZodObject<ZodRawShape>).shape);
      const sobran = Object.keys(salida).filter((k) => !declaradas.includes(k));

      expect(sobran, `${nombre} devuelve campos sin declarar`).toEqual([]);
    },
  );

  /**
   * Un `outputSchema` que no es un objeto no describe nada: un agente no
   * puede saber qué campos leer. Se comprueba aparte porque el test de
   * arriba usa `.shape`, y sin esto un esquema degenerado lo rompería
   * con un error de acceso en vez de con un diagnóstico.
   */
  test.for(TOOLS)("$id: su outputSchema es un objeto con forma", async ({ build }) => {
    const tool = await captureTool(build(makeContext({ workspaceRoot: RAIZ })));
    const shape = (tool.outputSchema as Partial<ZodObject<ZodRawShape>>).shape;
    expect(shape, `${tool.name} no declara una forma de objeto`).toBeDefined();
    expect(Object.keys(shape ?? {}).length).toBeGreaterThan(0);
  });

  /**
   * Todos prometen `ok: true` en el camino feliz. El error viaja por el
   * sobre universal de `toolError`, con `isError`, así que un cliente
   * distingue los dos casos sin que cada tool invente su forma.
   */
  test.for(TOOLS)(
    "$id: el camino feliz responde ok",
    { timeout: 240_000 },
    async ({ build, input }) => {
      const { salida, nombre } = await invocar(build, input());
      expect(salida["ok"], `${nombre} no devolvió ok:true`).toBe(true);
    },
  );
});
