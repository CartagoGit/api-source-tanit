#!/usr/bin/env bun
/**
 * `bun run scripts/release/publish-gate.mjs` — lo que se publica.
 *
 * ## El problema que resuelve
 *
 * La release adjunta sus assets con `softprops/action-gh-release`, que
 * nombra cada asset por su `basename`. Un staging tiene **cinco**
 * ficheros `release-manifest.json` —el mergeado y uno por plataforma—,
 * así que un glob recursivo de `release-manifest.json` los adjunta
 * todos con el mismo nombre. Como `overwrite_files` va por defecto
 * `true`, el
 * último que sube **pisa** al primero, y en la release queda un
 * manifest parcial de una plataforma en vez del manifest de la release.
 *
 * Y no es un problema teórico: el `fail_on_unmatched_files` del
 * workflow no lo ve, porque el glob sí encuentra ficheros.
 *
 * ## Lo que este script es
 *
 * La **única** lista de lo que se publica. El workflow no tiene globs
 * propios: pide la lista aquí, y esta lista es la que se adjunta. Si
 * las dos se separan, el gate deja de gatear.
 *
 * ## Lo que falla cerrado
 *
 *   · Un target de la matriz que no está en la release.
 *   · Un artefacto sin firmar.
 *   · Un artefacto que el manifest describe y la release no adjunta.
 *   · Un asset adjunto que el manifest no describe.
 *   · Dos assets con el mismo `basename`: se pisarían al subirlos.
 *   · Un manifest que no es el mergeado.
 *   · Un SBOM, una provenance o una attestation que falten: una
 *     release que se publica y no se puede auditar no se publica.
 *
 * Uso:
 *   bun run scripts/release/publish-gate.mjs --stage <dir> [--manifest <file>]
 *   bun run scripts/release/publish-gate.mjs --stage <dir> --list
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import {
  RELEASE_MANIFEST_FILE,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_PUBLISH_PATTERNS,
  RELEASE_REQUIRED_ASSET_KINDS,
  RELEASE_TARGET_MATRIX,
} from "../../packages/contracts/constants/release/signing.constant.js";

/** Error con mensaje para la persona que lee, no para el log. */
class ReleaseError extends Error {}

/** Los ficheros del staging, como rutas relativas con `/`. */
async function collectFiles(dir, base = dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // Un `.app` es un bundle: un directorio con el binario dentro. No
    // se publica su contenido fichero a fichero.
    if (entry.isDirectory() && entry.name.endsWith(".app")) continue;
    if (entry.isDirectory()) await collectFiles(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

/**
 * Convierte un patrón de publication en una expresión regular.
 *
 * La semántica es la de los globs de GitHub: el doble asterisco
 * seguido de barra son cero o más carpetas, y un asterisco no cruza
 * una carpeta.
 */
function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Una sola pasada: si se reemplazase `**/` primero y `*` después, el
  // asterisco del grupo insertado se volvería a convertir.
  const body = escaped.replace(/\*\*\/|\*/g, (match) =>
    match === "**/" ? "(?:.*/)?" : "[^/]*",
  );
  return new RegExp(`^${body}$`);
}

/** Los ficheros del staging que casan con algún patrón. */
function selectPublished(files, patterns) {
  const expressions = patterns.map((pattern) => patternToRegExp(pattern));
  return files
    .filter((file) => expressions.some((expression) => expression.test(file)))
    .sort();
}

/** El `basename` de una ruta relativa. */
function baseName(relPath) {
  const parts = relPath.split("/");
  return parts[parts.length - 1];
}

/** Lee los argumentos de la línea de órdenes. */
function parseArgs(argv) {
  const args = { stage: undefined, manifest: undefined, list: false, allowUnsigned: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new ReleaseError(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--stage": args.stage = next(); break;
      case "--manifest": args.manifest = next(); break;
      case "--list": args.list = true; break;
      case "--allow-unsigned": args.allowUnsigned = true; break;
      case "--allow-unsigned=*": args.allowUnsigned = arg.endsWith("=true"); break;
      case "--help":
      case "-h": args.help = true; break;
      default:
        throw new ReleaseError(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/** Muestra el uso y sale. */
function usage() {
  console.log(
    [
      "publish-gate — decide what the release attaches, and refuses to publish anything else.",
      "",
      "  --stage <dir>        staging directory with the built artifacts",
      "  --manifest <file>    merged manifest (default: <stage>/release-manifest.json)",
      "  --list               print the files to attach, one per line",
      "  --allow-unsigned     accept unsigned artifacts (inspection only)",
    ].join("\n"),
  );
}

/** El punto de entrada. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (args.stage === undefined) {
    usage();
    throw new ReleaseError("`--stage` is required");
  }

  const stage = resolve(REPO_ROOT, args.stage);
  const manifestPath = args.manifest === undefined
    ? join(stage, RELEASE_MANIFEST_FILE)
    : resolve(REPO_ROOT, args.manifest);

  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new ReleaseError(`The merged manifest does not exist: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new ReleaseError(`The manifest could not be parsed: ${error.message}`);
  }

  if (manifest.schema !== RELEASE_MANIFEST_SCHEMA) {
    throw new ReleaseError(`Unexpected manifest schema: "${manifest.schema}"`);
  }

  const files = await collectFiles(stage);
  const published = selectPublished(files, RELEASE_PUBLISH_PATTERNS);
  const problems = [];

  if (published.length === 0) {
    problems.push("the staging holds nothing that the release would attach");
  }

  // --- el manifest adjunto -------------------------------------------------
  //
  // Sólo el mergeado. Los manifest por plataforma son estado
  // intermedio del runner, y subirlos con el mismo nombre del mergeado
  // deja en la release el manifest de una sola plataforma.
  const manifests = published.filter((file) => baseName(file) === RELEASE_MANIFEST_FILE);
  if (manifests.length === 0) {
    problems.push(`the release does not attach the merged manifest (${RELEASE_MANIFEST_FILE})`);
  } else if (manifests.length > 1) {
    problems.push(
      `the release attaches ${manifests.length} files named ${RELEASE_MANIFEST_FILE} ` +
        `(${manifests.join(", ")}): they would overwrite each other`,
    );
  } else if (manifests[0] !== RELEASE_MANIFEST_FILE) {
    problems.push(
      `the release attaches ${manifests[0]} instead of the merged manifest ` +
        `(${RELEASE_MANIFEST_FILE})`,
    );
  }

  // --- los targets de la matriz ---------------------------------------------
  //
  // El glob de los `.dmg` sigue encontrando un `.dmg` aunque falte el
  // del otro brazo, así que la cobertura de la matriz se comprueba
  // aquí, y no por el recuento de ficheros.
  const covered = new Set(
    (manifest.artifacts ?? []).map((artifact) => `${artifact.os}/${artifact.arch}/${artifact.bundle}`),
  );
  for (const target of RELEASE_TARGET_MATRIX) {
    const key = `${target.os}/${target.arch}/${target.bundle}`;
    if (!covered.has(key)) {
      problems.push(`the release does not cover the target ${key}`);
    }
  }

  // --- los artefactos -------------------------------------------------------
  const publishedSet = new Set(published);
  for (const artifact of manifest.artifacts ?? []) {
    if (!files.includes(artifact.path)) {
      problems.push(`${artifact.path}: the manifest describes it, but it is not in the staging`);
      continue;
    }
    if (!publishedSet.has(artifact.path)) {
      problems.push(`${artifact.path}: the release does not attach it`);
    }
    if ((artifact.signature ?? null) === null && !args.allowUnsigned) {
      problems.push(`${artifact.path}: the release does not attach an unsigned artifact`);
    }
  }

  // --- lo que se adjunta y el manifest no describe --------------------------
  const described = new Set([RELEASE_MANIFEST_FILE]);
  for (const artifact of manifest.artifacts ?? []) {
    described.add(artifact.path);
    if (artifact.signature !== null && artifact.signature !== undefined) {
      described.add(artifact.signature.path);
      if (artifact.signature.receipt !== null && artifact.signature.receipt !== undefined) {
        described.add(artifact.signature.receipt);
      }
    }
  }
  for (const asset of manifest.assets ?? []) {
    described.add(asset.path);
    if (asset.signature !== null && asset.signature !== undefined) {
      described.add(asset.signature.path);
      if (asset.signature.receipt !== null && asset.signature.receipt !== undefined) {
        described.add(asset.signature.receipt);
      }
    }
  }
  for (const file of published) {
    if (!described.has(file)) {
      problems.push(`${file}: the release attaches it, but the manifest does not describe it`);
    }
  }

  // --- la transparencia de la cadena de suministro --------------------------
  //
  // El SBOM, el statement de provenance y la attestation firmada son lo
  // que permite auditar lo que se descarga. Una release sin ellos es
  // una release que se publica y no se puede explicar: por eso el gate
  // falla cerrado y no avisa.
  //
  // El gate mira **el manifest**, no los ficheros: si el manifest no
  // describe un SBOM, es que el SBOM no se generó, y si el manifest lo
  // describe pero el fichero no está en el staging, es que se perdió.
  // Las dos cosas son un fallo de publicación.
  for (const kind of RELEASE_REQUIRED_ASSET_KINDS) {
    const assets = (manifest.assets ?? []).filter((asset) => asset.kind === kind);
    if (assets.length === 0) {
      problems.push(
        `the release does not attach a "${kind}" asset: the release cannot be audited`,
      );
      continue;
    }
    for (const asset of assets) {
      if (!files.includes(asset.path)) {
        problems.push(`${asset.path}: the manifest describes the "${kind}" asset, but it is not in the staging`);
      } else if (!publishedSet.has(asset.path)) {
        problems.push(`${asset.path}: the release does not attach the "${kind}" asset`);
      }
    }
  }

  // --- dos assets con el mismo nombre ---------------------------------------
  //
  // La acción que los sube los nombra por su `basename` y pisa el que
  // ya estaba: dos assets con el mismo nombre son un asset y un
  // archivo perdido.
  const byName = new Map();
  for (const file of published) {
    const name = baseName(file);
    const group = byName.get(name) ?? [];
    group.push(file);
    byName.set(name, group);
  }
  for (const [name, group] of byName) {
    if (group.length > 1) {
      problems.push(`the release attaches ${group.length} files named ${name} (${group.join(", ")}): they would overwrite each other`);
    }
  }

  if (problems.length > 0) {
    console.error(`✗ The release cannot be published: ${problems.length} problem(s).\n`);
    for (const problem of problems) {
      console.error(`  · ${problem}`);
    }
    console.error("\n  The release stops here: an unsigned or missing artifact never reaches a download.");
    return 1;
  }

  // El resumen va a **stderr**: con `--list` la salida estándar es la
  // lista, y nada más. El workflow la guarda en un output de GitHub y
  // se la pasa a la acción que sube los assets: una línea de más en
  // esa lista es un asset que no existe.
  console.error(`→ The release attaches ${published.length} file(s).`);

  if (args.list) {
    for (const file of published) {
      console.log(join(args.stage, file));
    }
  }

  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof ReleaseError) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  throw error;
}
