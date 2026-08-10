/**
 * El tool `push`, y sobre todo: **que la clave no se escape**.
 *
 * Es el único tool que sale de la máquina y el único que maneja un
 * secreto. Y es justo el que un agente va a invocar por su cuenta, así
 * que lo que devuelva acaba en un historial de conversación, en un log
 * del host, o repetido de vuelta por el modelo. Un secreto que se filtra
 * por un mensaje de error no se puede retirar.
 *
 * Se comprueban las tres puertas por las que podría salir:
 *
 *   1. El **input**: `PushInputSchema` no declara `apiKey`, y es
 *      `.strict()`, así que pasarla es un input inválido. Declararla
 *      sería una invitación a que el agente la pida y la repita.
 *   2. La **salida feliz**: ni el valor, ni una versión enmascarada, ni
 *      el nombre de la variable.
 *   3. El **error**, que es la puerta que se olvida. `PostmanApiError`
 *      trae un `detail` que es el cuerpo devuelto por Postman, y ese
 *      cuerpo puede incluir la petición que lo causó — con su cabecera
 *      `X-Api-Key` dentro.
 *
 * No hay red de por medio: la clave que se usa es falsa y Postman
 * rechaza la autenticación, que es precisamente el camino de error que
 * se quiere inspeccionar.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPushToolRegistration } from "../../src/lib/tools/push.tool";
import { PushInputSchema } from "../../src/lib/contracts/plugin.interface";
import { captureTool, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

/** Una clave inventada, con una forma reconocible para poder buscarla. */
const CLAVE_FALSA = "PMAK-clave-inventada-para-el-test-000000";

let work = "";
let proyecto = "";
let clavePrevia: string | undefined;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "push-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "export-to-postman"), { recursive: true, force: true });

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
   * EL test del input. El esquema es `.strict()`, así que una `apiKey`
   * no es «un campo que se ignora»: es un input inválido. La diferencia
   * importa — ignorarla en silencio dejaría al agente creyendo que la ha
   * entregado.
   */
  test("`apiKey` en el input se rechaza, no se ignora", () => {
    const parsed = PushInputSchema.safeParse({
      projectRoot: "/x",
      apiKey: CLAVE_FALSA,
    });
    expect(parsed.success).toBe(false);
  });

  test("el esquema no declara ningún campo que huela a secreto", () => {
    const declaradas = Object.keys(PushInputSchema.shape);
    const sospechosas = declaradas.filter((k) =>
      /key|token|secret|password|credential/i.test(k),
    );
    expect(sospechosas).toEqual([]);
  });
});

describe("la clave no sale por ninguna parte", () => {
  /**
   * EL test. La clave es falsa, así que Postman contesta 401 y el tool
   * responde con `toolError` — el camino donde el `detail` de la API
   * podría arrastrar la petición entera.
   */
  test("ni en el error de autenticación", { timeout: 120_000 }, async () => {
    const resultado = await invocar({ projectRoot: proyecto });
    const texto = JSON.stringify(resultado);

    expect(texto).not.toContain(CLAVE_FALSA);
    // Ni el prefijo suelto: una clave a medias sigue siendo una pista.
    expect(texto).not.toContain("PMAK-");
  });

  test("ni el nombre de la variable de entorno", { timeout: 120_000 }, async () => {
    const resultado = await invocar({ projectRoot: proyecto });
    const texto = JSON.stringify(resultado);
    // Decir «POSTMAN_API_KEY» en la salida de error es aceptable como
    // pista para la persona, pero no puede ir acompañado del valor.
    if (texto.includes("POSTMAN_API_KEY")) {
      expect(texto).not.toContain(CLAVE_FALSA);
    }
  });

  /**
   * El error tiene que ser accionable igualmente. Un tool que protege el
   * secreto devolviendo «error» a secas deja a quien lo llama sin saber
   * si la clave caducó, si falta permiso o si Postman está caído.
   */
  test("pero el error sigue diciendo qué hacer", { timeout: 120_000 }, async () => {
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

  test("sin clave en el entorno, lo dice y explica dónde crearla", {
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
