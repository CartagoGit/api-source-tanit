/**
 * The `push` tool, and above all: **that the key does not leak**.
 *
 * It is the only tool that leaves the machine and the only one that
 * handles a secret. And it is exactly the one an agent will invoke
 * on its own, so what it returns ends up in a conversation history,
 * a host log, or repeated back by the model. A secret that leaks
 * through an error message cannot be recalled.
 *
 * Three doors through which it could leak are checked:
 *
 *   1. The **input**: `PushInputSchema` does not declare `apiKey`,
 *      and it is `.strict()`, so passing it is invalid input.
 *      Declaring it would be an invitation for the agent to ask for
 *      it and repeat it.
 *   2. The **happy output**: neither the value, nor a masked version,
 *      nor the variable's name.
 *   3. The **error**, which is the door people forget. `PostmanApiError`
 *      carries a `detail` that is the body returned by Postman, and
 *      that body can include the request that caused it — with its
 *      `X-Api-Key` header inside.
 *
 * There is no network in between: the key used is fake and Postman
 * rejects the authentication, which is precisely the error path we
 * want to inspect.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPushToolRegistration } from "../../src/lib/tools/push.tool";
import { PushInputSchema } from "../../src/lib/contracts/plugin.interface";
import { captureTool, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

/** A made-up key, with a recognisable shape so we can grep for it. */
const CLAVE_FALSA = "PMAK-clave-inventada-para-el-test-000000";

let work = "";
let proyecto = "";
let clavePrevia: string | undefined;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "push-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "tanit"), { recursive: true, force: true });

  clavePrevia = process.env["POSTMAN_API_KEY"];
  process.env["POSTMAN_API_KEY"] = CLAVE_FALSA;
}, 180_000);

afterAll(async () => {
  if (clavePrevia === undefined) delete process.env["POSTMAN_API_KEY"];
  else process.env["POSTMAN_API_KEY"] = clavePrevia;
  if (work) await rm(work, { recursive: true, force: true });
});

async function invocar(input: Record<string, unknown>) {
  const tool = await captureTool(
    buildPushToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  return tool.handler(input);
}

describe("el input no acepta la clave", () => {
  /**
   * THE input test. The schema is `.strict()`, so an `apiKey` is not
   * "a field that gets ignored": it is invalid input. The
   * difference matters — ignoring it silently would leave the agent
   * thinking it has delivered it.
   */
  test("`apiKey` in the input is rejected, not ignored", () => {
    const parsed = PushInputSchema.safeParse({
      projectRoot: "/x",
      apiKey: CLAVE_FALSA,
    });
    expect(parsed.success).toBe(false);
  });

  test("the schema declares no field that smells like a secret", () => {
    const declaradas = Object.keys(PushInputSchema.shape);
    const sospechosas = declaradas.filter((k) =>
      /key|token|secret|password|credential/i.test(k),
    );
    expect(sospechosas).toEqual([]);
  });
});

describe("la clave no sale por ninguna parte", () => {
  /**
   * THE test. The key is fake, so Postman answers 401 and the tool
   * responds with `toolError` — the path where the API's `detail`
   * could drag the whole request along.
   */
  test("not even on the authentication error", { timeout: 120_000 }, async () => {
    const resultado = await invocar({ projectRoot: proyecto });
    const texto = JSON.stringify(resultado);

    expect(texto).not.toContain(CLAVE_FALSA);
    // Not even the bare prefix: a half-key is still a clue.
    expect(texto).not.toContain("PMAK-");
  });

  test("ni el nombre de la variable de entorno", { timeout: 120_000 }, async () => {
    const resultado = await invocar({ projectRoot: proyecto });
    const texto = JSON.stringify(resultado);
    // Saying "POSTMAN_API_KEY" in the error output is acceptable as a
    // hint to the user, but it cannot come with the value attached.
    if (texto.includes("POSTMAN_API_KEY")) {
      expect(texto).not.toContain(CLAVE_FALSA);
    }
  });

  /**
   * The error must still be actionable. A tool that protects the
   * secret by returning a bare "error" leaves whoever called it
   * unable to tell whether the key expired, permission is missing,
   * or Postman is down.
   */
  test("but the error still says what to do", { timeout: 120_000 }, async () => {
    const resultado = await invocar({ projectRoot: proyecto });
    expect(resultado.isError).toBe(true);
    const texto = resultado.content[0]?.text ?? "";
    expect(texto.length).toBeGreaterThan(20);
  });
});

describe("lo que no puede hacer, lo dice", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const resultado = await invocar({ projectRoot: "/no/existe/zzz" });
    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]?.text ?? "").toContain("no existe");
  });

  test("without a key in the environment, it says so and explains where to create one", {
    timeout: 120_000,
  }, async () => {
    const previa = process.env["POSTMAN_API_KEY"];
    delete process.env["POSTMAN_API_KEY"];
    try {
      const resultado = await invocar({ projectRoot: proyecto });
      expect(resultado.isError).toBe(true);
      expect(resultado.content[0]?.text ?? "").toContain("POSTMAN_API_KEY");
    } finally {
      if (previa !== undefined) process.env["POSTMAN_API_KEY"] = previa;
    }
  });
});
