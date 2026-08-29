/**
 * La ruta al CLI que el plugin spawnea.
 *
 * Este spec existe porque el plugin y el CLI **no comparten tipos**: lo
 * único que los une es una cadena con una ruta, y una cadena no la
 * comprueba nadie. Al reorganizar en `projects/` el CLI se movió y esta
 * cadena se quedó atrás en tres sitios; los tools seguían registrándose,
 * los tests seguían verdes, y `generate` fallaba solo al ejecutarlo de
 * verdad contra el host.
 *
 * Aquí se comprueba lo que ningún typecheck puede: que el fichero al
 * final de la ruta existe.
 */
import { describe, expect, test } from "vitest";
import { existsSync, statSync } from "node:fs";

import {
  CLI_SCRIPT_RELATIVE,
  resolveCliScript,
} from "../../src/lib/contracts/cli-path.constant";
import { workspaceRoot } from "../helpers/plugin-context";

const ROOT = workspaceRoot(import.meta.url);

describe("resolveCliScript", () => {
  // El test que importa: si alguien mueve el CLI, esto falla nombrando
  // la constante exacta en vez de romperle el tool a quien lo use.
  test("la ruta por defecto apunta a un fichero que existe", () => {
    const resolved = resolveCliScript(ROOT);
    expect(existsSync(resolved), resolved).toBe(true);
    expect(statSync(resolved).isFile()).toBe(true);
  });

  test("el override de `cliScript` gana", () => {
    expect(resolveCliScript(ROOT, "/otro/sitio/cli.ts")).toBe("/otro/sitio/cli.ts");
  });

  test("un override vacío no cuenta como override", () => {
    expect(resolveCliScript(ROOT, "")).toBe(resolveCliScript(ROOT));
  });

  test("es relativa, para poder componerla con cualquier workspace", () => {
    expect(CLI_SCRIPT_RELATIVE.startsWith("/")).toBe(false);
    expect(CLI_SCRIPT_RELATIVE.includes("\\")).toBe(false);
  });
});

describe("mcp-vertex.config.json", () => {
  /**
   * El host lee su `cliScript` del config, no de la constante. Son dos
   * copias de la misma ruta, así que la que manda en producción puede
   * quedarse vieja aunque la constante esté bien — que es exactamente lo
   * que pasó.
   */
  test("el `cliScript` configurado coincide con la constante", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(`${ROOT}/mcp-vertex.config.json`, "utf8");
    const config = JSON.parse(raw) as {
      plugins?: Record<string, { options?: Record<string, unknown> }>;
    };
    const configured = config.plugins?.["expostman"]?.options?.["cliScript"];
    expect(typeof configured).toBe("string");
    expect(configured).toBe(`\${workspaceFolder}/${CLI_SCRIPT_RELATIVE}`);
  });
});
