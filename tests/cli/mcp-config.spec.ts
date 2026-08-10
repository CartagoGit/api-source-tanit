/**
 * Que la configuración del servidor MCP hable del repo que existe.
 *
 * `plugins.search.options.roots` y `plugins.conventions.options.roots`
 * declaraban `contract`, `service`, `helper` y `plugins`: la estructura
 * anterior a que todo se moviera bajo `projects/`. El propio servidor lo
 * denunciaba en `overview.configIssues` con ocho incidencias —
 * *"does not exist in this workspace — the plugin will scan nothing"*.
 *
 * El fallo es de los malos: los dos plugins seguían **devolviendo
 * resultados**, solo que de una fracción del repo. Una búsqueda que no
 * encuentra algo no se distingue de una búsqueda sobre una carpeta que
 * no existe, así que la auditoría automática parecía completa mientras
 * nacía sesgada.
 *
 * Esto lo comprueba contra el disco, que es la única forma de que mover
 * una carpeta rompa aquí y no en silencio.
 */
import { describe, expect, test } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper";

interface IPluginOptions {
  readonly roots?: ReadonlyArray<string>;
}

interface IMcpConfig {
  readonly plugins?: Readonly<Record<string, { readonly options?: IPluginOptions }>>;
}

async function config(): Promise<IMcpConfig> {
  return JSON.parse(
    await readFile(join(REPO_ROOT, "mcp-vertex.config.json"), "utf8"),
  ) as IMcpConfig;
}

async function esDirectorio(rel: string): Promise<boolean> {
  try {
    return (await stat(join(REPO_ROOT, rel))).isDirectory();
  } catch {
    return false;
  }
}

/** Los plugins que declaran sobre qué carpetas trabajan. */
const CON_ROOTS = ["search", "conventions"] as const;

describe("las raíces que escanean los plugins", () => {
  test.for(CON_ROOTS)("%s las declara", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots;
    expect(roots, `${plugin} no declara roots`).toBeDefined();
    expect(roots?.length ?? 0).toBeGreaterThan(0);
  });

  // EL test: sin él, el servidor avisa y nadie lo lee.
  test.for(CON_ROOTS)("todas las raíces de %s existen en disco", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots ?? [];
    const fantasmas: string[] = [];
    for (const root of roots) {
      if (!(await esDirectorio(root))) fantasmas.push(root);
    }
    expect(
      fantasmas,
      `${plugin} escanea carpetas que no existen: ${fantasmas.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * El fallo simétrico: declarar tan poco que el plugin no vea el código.
   * `projects/` es donde vive todo lo que se publica; si no está, la
   * búsqueda y las convenciones miran cualquier cosa menos el producto.
   */
  test.for(CON_ROOTS)("%s cubre el código que se publica", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots ?? [];
    expect(roots).toContain("projects");
  });
});

/**
 * Los directorios sueltos que declara la configuración.
 *
 * `roots` ya se comprobaba; esto cubre el resto —`scaffoldDir`,
 * `auditDir`, `proposalsDir`…—, que era por donde se coló el fallo:
 * `issues.scaffoldDir` apuntaba a
 * `docs/mcp-vertex/proposals/retired/issues`, dentro del árbol de
 * propuestas, donde `lint:proposals` exige `<kind><NNNNN>-<slug>.md`. La
 * primera issue escrita ahí habría roto el gate del repositorio.
 */
describe("los directorios declarados en la configuración", () => {
  test("todos existen en disco", async () => {
    const c = await config();
    const fantasmas: string[] = [];

    for (const [nombre, plugin] of Object.entries(c.plugins ?? {})) {
      const options = (plugin as { options?: Record<string, unknown> }).options ?? {};
      for (const [clave, valor] of Object.entries(options)) {
        if (!/Dir$/.test(clave) || typeof valor !== "string") continue;
        if (!(await esDirectorio(valor))) fantasmas.push(`${nombre}.${clave} → ${valor}`);
      }
    }

    expect(fantasmas, `directorios declarados que no existen`).toEqual([]);
  });

  /**
   * Y ninguno puede apuntar dentro del árbol de propuestas: ahí manda
   * `lint:proposals`, que exige un nombre con id y kind. Un plugin que
   * escriba ahí rompe el gate a la primera.
   */
  test("ninguno escribe dentro del árbol de propuestas", async () => {
    const c = await config();
    const invasores: string[] = [];

    for (const [nombre, plugin] of Object.entries(c.plugins ?? {})) {
      const options = (plugin as { options?: Record<string, unknown> }).options ?? {};
      for (const [clave, valor] of Object.entries(options)) {
        if (clave === "auditDir" || !/Dir$/.test(clave)) continue;
        if (typeof valor !== "string") continue;
        if (valor.includes("proposals/")) invasores.push(`${nombre}.${clave} → ${valor}`);
      }
    }

    expect(invasores).toEqual([]);
  });
});

describe("el plugin propio se declara con una ruta que existe", () => {
  /**
   * Un `path` que no resuelve deja al plugin fuera sin ruido: el
   * servidor arranca igual, con un tool menos. Se comprueba todo
   * `"path": "…"` del fichero, no solo el de expostman, para que
   * añadir un plugin nuevo con una ruta mal escrita también falle.
   */
  test("todos los `path` declarados apuntan a algo que existe", async () => {
    const raw = await readFile(join(REPO_ROOT, "mcp-vertex.config.json"), "utf8");
    const rutas = [...raw.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(rutas.length, "ningún plugin declara `path`").toBeGreaterThan(0);
    for (const ruta of rutas) {
      // `${workspaceFolder}` lo expande el host, no nosotros.
      if (ruta.includes("${")) continue;
      const abs = join(REPO_ROOT, ruta.replace(/^\.\//, ""));
      await expect(stat(abs), `${ruta} no existe`).resolves.toBeDefined();
    }
  });
});
