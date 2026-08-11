/**
 * Generar y comprobar, en los veintiún frameworks.
 *
 * La invariante es la más simple que existe: una colección **recién
 * generada** de un proyecto está, por definición, al día con ese
 * proyecto. Si `check` dice otra cosa, `check` está mal.
 *
 * Se midió antes de escribir esto: **13 de 22 ejemplos** reportaban
 * deriva total sobre una colección que acababa de salir de `generate`.
 * `check` es uno de los diez tools MCP, y su única pregunta es «¿se ha
 * desincronizado mi colección?»; contestar que sí siempre hace que un
 * agente regenere en bucle.
 *
 * ## Por qué no había test
 *
 * Lo había: `check-rpc.test.ts` y `check.tool.spec.ts`. Los dos prueban
 * GraphQL, y GraphQL era de los nueve que funcionaban. La cobertura por
 * framework de este comando era del 9 %, y el bug vivía justo en el 91 %
 * restante.
 *
 * ## Qué se afirma, y qué no
 *
 * No se afirma un número de endpoints: eso obligaría a mantener
 * veintiuna cifras cada vez que cambie un ejemplo, y es lo que hace que
 * un test así se acabe borrando. Se afirma que **las dos listas de
 * deriva están vacías**, que es la propiedad de verdad y vale igual en
 * los veintiuno.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, EXAMPLES_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

/**
 * Los ejemplos, leídos del disco.
 *
 * No se usa `FRAMEWORK_IDS`: hay ejemplos que no son un framework
 * —`example-app`, `example-openapi-headers`— y también cuentan, porque
 * son proyectos reales que alguien puede escanear.
 */
const EJEMPLOS = (await readdir(EXAMPLES_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && e.name.startsWith("example-"))
  .map((e) => e.name.replace(/^example-/, ""))
  .sort();

let work = "";
const raiz = new Map<string, string>();

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "check-tras-generar-"));
  for (const framework of EJEMPLOS) {
    const root = join(work, framework);
    await copyExampleClean(exampleDir(framework), root);
    await runProcess("bun", [
      join(CLI_COMMANDS_DIR, "generate.script.ts"),
      "--project-root",
      root,
    ]);
    raiz.set(framework, root);
  }
}, 900_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("una colección recién generada está al día", () => {
  test("hay ejemplos que comprobar", () => {
    expect(EJEMPLOS.length).toBeGreaterThan(20);
  });

  test.for(EJEMPLOS)(
    "%s: `check` no encuentra ninguna deriva",
    { timeout: 240_000 },
    async (framework) => {
      const { code, output } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, "diff.script.ts"),
        "--project-root",
        raiz.get(framework) ?? "",
      ]);

      expect(
        output,
        `${framework}: la colección acaba de salir de \`generate\` y \`check\` ve deriva`,
      ).toContain("in sync");
      expect(code, output).toBe(0);
    },
  );
});
