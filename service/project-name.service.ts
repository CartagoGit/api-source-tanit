/**
 * Nombre del proyecto, leído del manifiesto de su ecosistema.
 *
 * Esto vivía dentro de `project-loader` y miraba **solo**
 * `composer.json`. O sea: un proyecto Laravel se llamaba como su
 * paquete y los otros once se llamaban como su carpeta, sin que nada lo
 * dijera. Es el mismo sesgo que tenía el resto del paquete cuando esto
 * era una herramienta solo para Laravel.
 *
 * El nombre no es cosmético: entra en el `_postman_id` determinista, que
 * es lo que hace que reimportar el mismo proyecto **actualice** su
 * colección en Postman en vez de añadir una copia. Dos proyectos
 * distintos tienen que dar nombres distintos, y el mismo proyecto tiene
 * que dar siempre el mismo.
 *
 * Orden: primer manifiesto que exista y declare un nombre; si ninguno,
 * el nombre de la carpeta. La lista está ordenada de más específico a
 * menos, para que un repo con `pom.xml` y `package.json` (Spring Boot
 * con un front al lado) se identifique por el backend.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

/** Cómo se saca el nombre de un manifiesto concreto. */
interface IManifest {
  /** Fichero a buscar en la raíz del proyecto. */
  readonly file: string;
  /** Devuelve el nombre declarado, o `null` si el fichero no lo trae. */
  readonly extract: (text: string) => string | null;
}

/** Se queda con el último segmento de `vendor/paquete` o `@scope/pkg`. */
function lastSegment(value: string): string | null {
  const parts = value.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

function fromJsonName(text: string): string | null {
  const match = /"name"\s*:\s*"([^"]+)"/.exec(text);
  return match?.[1] ? lastSegment(match[1]) : null;
}

const MANIFESTS: readonly IManifest[] = [
  // PHP — Laravel, Symfony.
  { file: "composer.json", extract: fromJsonName },
  // Java — Spring Boot con Maven.
  {
    file: "pom.xml",
    // El primer `<artifactId>` de un pom suele estar dentro de
    // `<parent>`, y es el del BOM del que se hereda
    // (`spring-boot-starter-parent`), no el del proyecto. Se quita ese
    // bloque antes de buscar.
    extract: (text) => {
      const withoutParent = text.replace(/<parent>[\s\S]*?<\/parent>/g, "");
      return /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(withoutParent)?.[1] ?? null;
    },
  },
  // Java/Kotlin — Gradle.
  {
    file: "settings.gradle",
    extract: (text) => /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ?? null,
  },
  {
    file: "settings.gradle.kts",
    extract: (text) => /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ?? null,
  },
  // Go.
  {
    file: "go.mod",
    extract: (text) => {
      const module = /^\s*module\s+(\S+)/m.exec(text)?.[1];
      return module ? lastSegment(module) : null;
    },
  },
  // Rust.
  {
    file: "Cargo.toml",
    extract: (text) => /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? null,
  },
  // Python — PEP 621 y Poetry.
  {
    file: "pyproject.toml",
    extract: (text) => /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? null,
  },
  // JavaScript/TypeScript — Express, NestJS, Next.js, Fastify…
  { file: "package.json", extract: fromJsonName },
];

/**
 * Nombre del proyecto en `projectRoot`.
 *
 * Nunca lanza: si no hay manifiesto legible, cae al nombre de la
 * carpeta, que siempre existe.
 */
export async function detectProjectNameIn(projectRoot: string): Promise<string> {
  for (const manifest of MANIFESTS) {
    try {
      const text = await readFile(join(projectRoot, manifest.file), "utf8");
      const name = manifest.extract(text)?.trim();
      if (name) return name;
    } catch {
      // El manifiesto no existe o no se puede leer: se prueba el
      // siguiente. No es un error, es lo normal en 7 de cada 8.
    }
  }

  // .NET no declara el nombre dentro del `.csproj`: es el propio nombre
  // del fichero.
  const csproj = await findCsproj(projectRoot);
  if (csproj) return csproj.replace(/\.csproj$/i, "");

  return basename(projectRoot) || "unnamed";
}

async function findCsproj(projectRoot: string): Promise<string | null> {
  try {
    const entries = await readdir(projectRoot);
    return entries.find((entry) => entry.toLowerCase().endsWith(".csproj")) ?? null;
  } catch {
    return null;
  }
}
