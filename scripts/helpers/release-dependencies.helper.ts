/**
 * Los lockfiles del repo, leídos.
 *
 * Hay dos lockfiles y los dos tienen formato propio: `Cargo.lock` es
 * TOML y `bun.lock` es JSON con comas finales. Los dos los leen **dos**
 * sitios —el script que construye el SBOM y el que lo verifica—, y
 * cuando cada uno lleva su propia lectura el verificador acaba
 * comprobando una cosa distinta de la que el constructor ha escrito.
 *
 * Por eso el parseo vive aquí: un solo sitio, un solo criterio.
 *
 * ## Lo que se lee y lo que no
 *
 *   · De `Cargo.lock` sale el grafo **resuelto** de crates: versiones
 *     exactas y el checksum de cada una. Es lo que va en el SBOM.
 *   · De `Cargo.toml` sale qué crates son **directas**. El lock no lo
 *     dice: dice el árbol entero, y el árbol entero no tiene raíz.
 *   · De `bun.lock` sale el grafo de paquetes de npm con su versión
 *     resuelta y su hash de tarball.
 */

/** Una crate del lockfile de Rust. */
export interface ICargoPackage {
  readonly name: string;
  readonly version: string;
  /** El SHA-256 del `.crate`, tal y como lo anota el lockfile. */
  readonly checksum?: string;
  /** De dónde viene. Los crates del propio repo no la tienen. */
  readonly source?: string;
  /** Los nombres de las crates de las que depende. */
  readonly dependencies: readonly string[];
}

/** Un paquete del lockfile de Bun. */
export interface IBunPackage {
  readonly name: string;
  readonly version: string;
  /** El nombre de cada dependencia, con su rango declarado. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** El hash del tarball, en base64, sin el prefijo del algoritmo. */
  readonly hash?: string;
}

/**
 * Quita las comas finales de un JSON con comas trailing.
 *
 * `bun.lock` las lleva y `JSON.parse` no las acepta. La conversión
 * tiene que ser consciente de las cadenas: quitar comas a lo bruto
 * rompe un valor que contiene `,}`. Por eso lleva estado.
 */
export function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      // ¿Lo que viene después (saltando espacios) cierra algo?
      let ahead = i + 1;
      while (ahead < text.length && /\s/.test(text[ahead] ?? "")) ahead += 1;
      const next = text[ahead] ?? "";
      if (next === "}" || next === "]") continue;
    }
    out += char;
  }
  return out;
}

/**
 * Las dependencias **directas** del crate del escritorio.
 *
 * Se leen del `Cargo.toml` porque el lock no dice cuál es directa: dice
 * el grafo entero. El grafo entero sirve para las aristas; la
 * dependencia directa sirve para saber de dónde cuelga el árbol.
 *
 * Sólo cuenta `[dependencies]`: lo que va en `[build-dependencies]` o
 * en `[dev-dependencies]` no viaja dentro del binario. `tauri-build` es
 * el caso claro —la usa el `build.rs` para generar el código de Tauri y
 * no está en el binario—, y declararlo como dependencia directa del
 * producto es decir una mentira que el verificador acaba exigiendo.
 */
export function parseCargoDirectDependencies(text: string): string[] {
  return parseCargoSections(text, ["dependencies"]);
}

/**
 * Las dependencias que **no** van dentro del binario.
 *
 * Las de `[build-dependencies]` y las de `[dev-dependencies]` se
 * resuelven en el lockfile como cualquier otra, así que un SBOM que
 * solo mira el lock las declara: el SBOM acaba diciendo que el producto
 * lleva dentro un compilador de crates. Esta lista es la que las deja
 * fuera.
 */
export function parseCargoBuildDependencies(text: string): string[] {
  return parseCargoSections(text, ["build-dependencies", "dev-dependencies"]);
}

/**
 * Los nombres declarados en las secciones de dependencia pedidas.
 *
 * El parser es a mano —son cuatro líneas de formato— y sólo acepta
 * las secciones que se le piden: cada sitio decide si cuenta una
 * dependencia de runtime o una de build.
 */
function parseCargoSections(text: string, sections: readonly string[]): string[] {
  const names: string[] = [];
  let inSection = false;
  const wanted = new Set(sections);
  for (const line of text.split("\n")) {
    // Cualquier sección cierra la anterior: `[profile.release]` no es una
    // sección de dependencias, y sus claves (`opt-level`, `lto`,
    // `strip`) no son crates.
    const section = /^\[([^\]]+)\]$/.exec(line.trim());
    if (section !== null) {
      inSection = wanted.has(section[1] ?? "");
      continue;
    }
    if (!inSection) continue;
    const entry = /^([A-Za-z0-9_-]+)\s*=/.exec(line.trim());
    if (entry !== null && entry[1] !== undefined) names.push(entry[1]);
  }
  return names;
}

/**
 * El grafo de crates de Rust.
 *
 * Sale de `Cargo.lock`: es el conjunto **resuelto** —con versiones
 * exactas y con el checksum de cada crate—, que es lo que un SBOM
 * necesita. `Cargo.toml` dice lo que se pidió; el lock dice lo que se
 * empaquetó.
 */
export function parseCargoLock(text: string): ICargoPackage[] {
  const packages: ICargoPackage[] = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /\nname\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const version = /\nversion\s*=\s*"([^"]+)"/.exec(block)?.[1];
    if (name === undefined || version === undefined) continue;
    const checksum = /\nchecksum\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const source = /\nsource\s*=\s*"([^"]+)"/.exec(block)?.[1];
    const dependencies: string[] = [];
    const section = /\ndependencies\s*=\s*\[([\s\S]*?)\]/.exec(block)?.[1] ?? "";
    for (const line of section.split("\n")) {
      const entry = /"([^"]+)"/.exec(line)?.[1];
      if (entry === undefined) continue;
      // La entrada puede ser `nombre`, `nombre version` o
      // `nombre version (source)`. El nombre es lo que casa con el
      // paquete del lock.
      dependencies.push(entry.split(" ")[0] ?? entry);
    }
    packages.push({
      name,
      version,
      ...(checksum === undefined ? {} : { checksum }),
      ...(source === undefined ? {} : { source }),
      dependencies,
    });
  }
  return packages;
}

/**
 * El grafo de paquetes de Bun.
 *
 * `bun.lock` es un objeto con `packages`, que mapea nombre → entrada.
 * La entrada es `[nombre@versión, registry, {dependencies}, hash]`.
 */
export function parseBunLock(text: string): Map<string, IBunPackage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripTrailingCommas(text));
  } catch (error) {
    throw new Error(`Could not parse bun.lock: ${error instanceof Error ? error.message : String(error)}`);
  }
  const packages = new Map<string, IBunPackage>();
  const raw = (parsed as { packages?: unknown } | null)?.packages;
  if (typeof raw !== "object" || raw === null) return packages;
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue;
    const identifier = typeof entry[0] === "string" ? entry[0] : "";
    const at = identifier.lastIndexOf("@");
    const version = at > 0 ? identifier.slice(at + 1) : "";
    const meta = (entry[2] ?? {}) as { dependencies?: unknown };
    const dependencies =
      typeof meta.dependencies === "object" && meta.dependencies !== null
        ? (meta.dependencies as Record<string, string>)
        : {};
    const hash = entry.find((item) => typeof item === "string" && item.startsWith("sha512-"));
    packages.set(name, {
      name,
      version,
      dependencies,
      ...(typeof hash === "string" ? { hash: hash.slice("sha512-".length) } : {}),
    });
  }
  return packages;
}
