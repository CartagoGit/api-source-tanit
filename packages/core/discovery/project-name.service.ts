/**
 * Project name, read from its ecosystem manifest.
 *
 * This logic used to live inside `project-loader` and looked **only** at
 * `composer.json`. A Laravel project was therefore named after its package,
 * while the other eleven were named after their directories, with no explicit
 * rule. This was the same bias the rest of the package had when it was a
 * Laravel-only tool.
 *
 * The name is not cosmetic: it feeds the deterministic `_postman_id`, which
 * makes reimporting the same project **update** its Postman collection instead
 * of adding a copy. Different projects must have different names, and the
 * same project must always produce the same name.
 *
 * Order: the first manifest that exists and declares a name; otherwise, the
 * directory name. The list runs from most specific to least specific so a repo
 * with both `pom.xml` and `package.json` (Spring Boot with a frontend alongside
 * it) is identified by its backend.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

/** How to extract a name from a specific manifest. */
interface IManifest {
  /** File to search for at the project root. */
  readonly file: string;
  /** Returns the declared name, or `null` if the file does not contain one. */
  readonly extract: (text: string) => string | null;
}

/** Takes the last segment of `vendor/package` or `@scope/pkg`. */
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
  // PHP — Laravel and Symfony.
  { file: "composer.json", extract: fromJsonName },
  // Java — Spring Boot with Maven.
  {
    file: "pom.xml",
    // The first `<artifactId>` in a pom usually belongs to the inherited
    // `<parent>` BOM (`spring-boot-starter-parent`), not to the project. Remove
    // that block before searching.
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
  // Python — PEP 621 and Poetry.
  {
    file: "pyproject.toml",
    extract: (text) => /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? null,
  },
  // JavaScript/TypeScript — Express, NestJS, Next.js, Fastify…
  { file: "package.json", extract: fromJsonName },
];

/**
 * Project name in `projectRoot`.
 *
 * Never throws: if no readable manifest exists, fall back to the directory
 * name, which always exists.
 */
export async function detectProjectNameIn(projectRoot: string): Promise<string> {
  for (const manifest of MANIFESTS) {
    try {
      const text = await readFile(join(projectRoot, manifest.file), "utf8");
      const name = manifest.extract(text)?.trim();
      if (name) return name;
    } catch {
      // The manifest is missing or unreadable: try the next one. This is not
      // an error; it is normal for seven of the eight cases.
    }
  }

  // .NET does not declare the name inside `.csproj`; the file name is the
  // project name.
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
