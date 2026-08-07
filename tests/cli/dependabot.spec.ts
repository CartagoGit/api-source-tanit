/**
 * Qué mira Dependabot, qué no, y por qué los manifiestos de mentira
 * llevan versiones al día.
 *
 * Dependabot tiene dos mitades que se configuran distinto:
 *
 *   · Las **actualizaciones** salen de `.github/dependabot.yml`, que
 *     nombra los directorios uno a uno.
 *   · Las **alertas** salen del *grafo de dependencias*, que escanea
 *     todos los manifiestos del repositorio y no admite exclusiones por
 *     ruta.
 *
 * Confundirlas costó una ronda entera: se declararon en el `.yml` solo
 * los dos paquetes reales dando por hecho que las 67 alertas abiertas se
 * cerrarían, y no se movió ni una. Lo que dejó de llegar fueron los PR
 * de actualización.
 *
 * Y hacía falta que se cerraran, porque las 67 salían de los **50
 * manifiestos que este repo contiene y no son suyos**: cada proyecto de
 * `examples/` y cada fixture de `tests/` trae el suyo, porque es de ahí
 * de donde los scanners deducen el framework. Las trece rutas señaladas
 * estaban todas bajo `examples/` o `tests/`, ni una bajo un paquete
 * real, mientras `bun audit` seguía en cero. Eso no es seguridad: es
 * ruido que **esconde** los avisos de verdad.
 *
 * Como el grafo no se puede filtrar, la palanca que queda es lo que los
 * manifiestos falsos declaran, y de ahí la política que este spec
 * vigila: **un manifiesto de ejemplo declara la versión que declararía
 * hoy un proyecto real**. No cuesta nada —ese código no se ejecuta
 * jamás— y a cambio el grafo no tiene nada que señalar.
 */
import { describe, expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper";

const DEPENDABOT_YML = join(REPO_ROOT, ".github", "dependabot.yml");

/**
 * Suelo de versión por paquete: la primera versión sin avisos abiertos.
 *
 * Cada entrada es un paquete que **llegó a alertar de verdad**, y el
 * número es el `first_patched_version` que dio la propia alerta. No es
 * una lista de deseos: es el registro de lo que ya pasó, para que no
 * vuelva a pasar.
 */
const VERSION_FLOOR: Readonly<Record<string, string>> = {
  "@apollo/server": "5.5.0",
  "@nestjs/common": "11.1.18",
  "@nestjs/core": "11.1.18",
  "@nestjs/platform-express": "11.1.18",
  fastify: "5.7.2",
  "github.com/gin-gonic/gin": "1.9.1",
  "github.com/gofiber/fiber/v2": "2.52.14",
  "laravel/framework": "12.60.0",
  next: "15.5.21",
};

/** Carpetas cuyos manifiestos son de mentira. */
const FAKE_ROOTS = ["examples", "tests"] as const;

/** `^15.5.21`, `>=1.2`, `6.4.*`, `v2.52.14` → `[15, 5, 21]`. */
function toParts(raw: string): number[] {
  const cleaned = raw.trim().replace(/^[\^~>=<v\s]+/, "");
  return cleaned.split(/[.\-+]/).map((chunk) => Number.parseInt(chunk, 10) || 0);
}

/** ¿`declared` es mayor o igual que `floor`? */
function meetsFloor(declared: string, floor: string): boolean {
  const left = toParts(declared);
  const right = toParts(floor);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

interface IDeclaration {
  readonly file: string;
  readonly name: string;
  readonly version: string;
}

/** Los pares nombre/versión de un manifiesto, sea del ecosistema que sea. */
function parseManifest(file: string, raw: string): IDeclaration[] {
  const found: IDeclaration[] = [];

  if (file.endsWith("go.mod")) {
    // `require x v1.2.3`, tanto suelto como dentro de un bloque.
    for (const m of raw.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\d.]+)/gm)) {
      found.push({ file, name: m[1] ?? "", version: m[2] ?? "" });
    }
    return found;
  }

  // `package.json` y `composer.json` comparten forma: un objeto de
  // nombre → rango, bajo una clave u otra.
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return found;
  }
  for (const key of ["dependencies", "devDependencies", "require", "require-dev"]) {
    const block = doc[key];
    if (typeof block !== "object" || block === null) continue;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      if (typeof version === "string") found.push({ file, name, version });
    }
  }
  return found;
}

const MANIFEST_NAMES = new Set(["package.json", "composer.json", "go.mod"]);

/** Todo lo que declaran los manifiestos de mentira. */
async function fakeDeclarations(): Promise<IDeclaration[]> {
  const out: IDeclaration[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "vendor") continue;
        await walk(full);
      } else if (MANIFEST_NAMES.has(entry.name)) {
        const raw = await readFile(full, "utf8");
        out.push(...parseManifest(relative(REPO_ROOT, full), raw));
      }
    }
  };
  for (const root of FAKE_ROOTS) await walk(join(REPO_ROOT, root));
  return out;
}

/** Los `directory:` declarados en la configuración. */
async function declaredDirectories(): Promise<string[]> {
  const raw = await readFile(DEPENDABOT_YML, "utf8");
  return [...raw.matchAll(/^\s*directory:\s*"([^"]+)"/gm)].map((m) => m[1] ?? "");
}

/** Los paquetes que este repo instala de verdad. */
async function realPackages(): Promise<string[]> {
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as {
    workspaces?: string[];
  };
  // La raíz más cada miembro del workspace. Un workspace es, por
  // definición, un paquete que `bun install` resuelve.
  return ["/", ...(pkg.workspaces ?? []).map((w) => `/${w}`)];
}

describe("qué directorios se actualizan", () => {
  test("existe la configuración", async () => {
    await expect(readFile(DEPENDABOT_YML, "utf8")).resolves.toContain("version: 2");
  });

  // Un paquete real sin vigilar es una dependencia que envejece sola.
  test("cubre todos los paquetes que se instalan de verdad", async () => {
    const declared = await declaredDirectories();
    for (const dir of await realPackages()) {
      expect(declared, `falta ${dir}`).toContain(dir);
    }
  });

  /**
   * El fallo simétrico: si alguien añade `examples/` a la lista para
   * "cubrirlo todo", vuelven las decenas de PR de actualización sobre
   * dependencias que nadie instala.
   */
  test("no pide actualizaciones de los manifiestos de mentira", async () => {
    for (const dir of await declaredDirectories()) {
      expect(dir, `${dir} no es un paquete de este repo`).not.toMatch(/^\/(examples|tests)\b/);
    }
  });

  test("las acciones del workflow también se vigilan", async () => {
    // Una acción vieja es código de terceros ejecutándose con el token
    // del repositorio.
    await expect(readFile(DEPENDABOT_YML, "utf8")).resolves.toContain("github-actions");
  });
});

describe("qué versiones declaran los manifiestos de mentira", () => {
  /**
   * EL test. Sin él, copiar un ejemplo viejo para hacer uno nuevo
   * reintroduce las alertas sin que nadie se entere hasta que GitHub
   * reconstruye el grafo, que es días después y en otra rama.
   */
  test("ninguno declara una versión con avisos abiertos", async () => {
    const culpables = (await fakeDeclarations())
      .filter((d) => VERSION_FLOOR[d.name] !== undefined)
      .filter((d) => !meetsFloor(d.version, VERSION_FLOOR[d.name] ?? "0"))
      .map((d) => `${d.file}: ${d.name}@${d.version} < ${VERSION_FLOOR[d.name]}`);

    expect(culpables, culpables.join("\n")).toEqual([]);
  });

  /**
   * El suelo solo sirve si alguien lo alcanza. Si un paquete de la
   * tabla ya no aparece en ningún manifiesto, la entrada sobra y hay
   * que borrarla — si no, la tabla se convierte en folclore.
   */
  test("cada suelo corresponde a un paquete que se declara de verdad", async () => {
    const declarados = new Set((await fakeDeclarations()).map((d) => d.name));
    for (const name of Object.keys(VERSION_FLOOR)) {
      expect(declarados, `${name} ya no se declara: sobra su suelo`).toContain(name);
    }
  });

  // Comprobación del comparador, que es donde se esconden estos fallos.
  test("el comparador entiende los rangos que hay en los manifiestos", () => {
    expect(meetsFloor("^15.5.21", "15.5.21")).toBe(true);
    expect(meetsFloor("^14.0.0", "15.5.21")).toBe(false);
    expect(meetsFloor("v2.52.14", "2.52.14")).toBe(true);
    expect(meetsFloor("v2.52.0", "2.52.14")).toBe(false);
    expect(meetsFloor("^12.61.1", "12.60.0")).toBe(true);
    expect(meetsFloor("^11.0", "12.60.0")).toBe(false);
    // 5.10 > 5.9: comparación numérica, no de cadenas.
    expect(meetsFloor("^5.10.0", "5.9.0")).toBe(true);
  });
});

describe("la configuración se explica sola", () => {
  test("distingue actualizaciones de alertas, que es lo que se confundió", async () => {
    const raw = await readFile(DEPENDABOT_YML, "utf8");
    expect(raw).toContain("grafo de dependencias");
    expect(raw).toContain("examples/");
    expect(raw.split("\n").filter((l) => l.startsWith("#")).length).toBeGreaterThan(10);
  });
});
