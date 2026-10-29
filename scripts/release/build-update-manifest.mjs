#!/usr/bin/env bun
/**
 * `bun run scripts/release/build-update-manifest.mjs` — el manifest de
 * actualización, firmado.
 *
 * Lee el manifest de la release que produce
 * `scripts/release/prepare-artifacts.mjs`, y de ahí saca **qué
 * artefactos existen** (sistema, arquitectura, formato y ruta). No
 * vuelve a recorrer el staging para inventar su propia lista: la
 * lista de lo que se publica la dice un solo sitio, y este es un
 * consumidor de esa lista, no otra lista.
 *
 * ## Qué firma
 *
 * Dos cosas, con dos firmas distintas:
 *
 *   · El **manifest**, para que el cliente sepa que la URL y el hash
 *     que trae son los que publicó la release y no los que le
 *     mandaron por el camino.
 *   · Cada **instalador**, para que el cliente sepa que los bytes que
 *     ha descargado son los que se firmaron.
 *
 * La firma es Ed25519 y la clave **privada no está en el repo**: sale
 * de un secreto del CI, se pasa por ruta, y el script nunca la
 * imprime ni la copia a ningún sitio. Lo que hay versionado en el
 * repo es la clave pública (`packages/desktop/keys/`).
 *
 * ## Por qué el hash se recalcula
 *
 * El manifest de la release ya trae un SHA-256 por artefacto. Este
 * script **no se lo cree**: lo recalcula sobre el fichero, y si no
 * cuadra con lo que dice el manifest de la release, para. Un digest
 * que viene de otro sitio es una afirmación; uno recalculado es una
 * medida.
 *
 * Uso:
 *   bun run scripts/release/build-update-manifest.mjs --stage <dir> --out <dir> --key <pem>
 *   bun run scripts/release/build-update-manifest.mjs --stage <dir> --out <dir> --key-env TANIT_UPDATER_KEY
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import { RELEASE_MANIFEST_FILE } from "../../packages/contracts/constants/release/signing.constant.js";
import {
  UPDATE_MANIFEST_FILE,
  UPDATE_MANIFEST_SCHEMA,
  UPDATE_PUBLIC_KEY_ID,
  UPDATE_SIGNATURE_ALGORITHM,
  UPDATE_SIGNATURE_FILE,
} from "../../packages/contracts/constants/release/updater.constant.js";

/** Un error de la release: no es un fallo de Node, es un fallo de la release. */
class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** Los `os` que el updater entiende. */
const KNOWN_OS = ["macos", "windows", "linux"];
/** Las arquitecturas que el updater entiende. */
const KNOWN_ARCH = ["x64", "arm64"];
/** Los formatos de instalador que el updater entiende. */
const KNOWN_BUNDLES = ["app", "dmg", "msi", "nsis", "deb", "appimage"];

/**
 * Las opciones del script.
 *
 * Se declara a mano y no con un parser: son pocas y un parser añade
 * un fichero que nadie va a leer.
 */
function parseArgs(argv) {
  const args = {
    stage: undefined,
    manifest: undefined,
    out: undefined,
    baseUrl: undefined,
    key: undefined,
    keyEnv: undefined,
    keyId: UPDATE_PUBLIC_KEY_ID,
    version: undefined,
    minimumVersion: undefined,
    source: undefined,
    workflow: undefined,
    commit: undefined,
  };

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
      case "--out": args.out = next(); break;
      case "--base-url": args.baseUrl = next(); break;
      case "--key": args.key = next(); break;
      case "--key-env": args.keyEnv = next(); break;
      case "--key-id": args.keyId = next(); break;
      case "--version": args.version = next(); break;
      case "--minimum-version": args.minimumVersion = next(); break;
      case "--source": args.source = next(); break;
      case "--workflow": args.workflow = next(); break;
      case "--commit": args.commit = next(); break;
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
      "build-update-manifest — build and sign the update manifest.",
      "",
      "  --stage <dir>            staging directory with the built artifacts",
      "  --manifest <file>        release manifest to read (default: <stage>/release-manifest.json)",
      "  --out <dir>              where to write latest.json and latest.json.sig",
      "  --base-url <url>         public base URL of the release assets",
      "  --key <file>             private key (PKCS#8 PEM) that signs the manifest and the artifacts",
      "  --key-env <var>          environment variable holding the path of the private key",
      "  --key-id <id>            public key identifier (default: tanit-updater-v1)",
      "  --version <semver>       version offered (default: the release manifest's)",
      "  --minimum-version <semver>   oldest version this manifest still supports",
      "  --source <text>          provenance source (default: release-desktop)",
      "  --workflow <text>        provenance workflow",
      "  --commit <sha>           provenance commit",
    ].join("\n"),
  );
}

/** SHA-256 de un fichero, en hexadecimal minúsculas. */
async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** El tamaño de un fichero, en bytes. */
async function sizeOf(path) {
  const info = await stat(path);
  return info.size;
}

/**
 * Resuelve una ruta dentro del staging y se niega a salir.
 *
 * El manifest de la release describe rutas relativas; una de ellas
 * con `..` apuntaría fuera del staging, y firmarla sería firmar un
 * fichero que el pipeline nunca produce.
 */
function resolveInside(stage, relativePath) {
  const absolute = resolve(stage, relativePath);
  const inside = relative(stage, absolute);
  if (inside.startsWith("..") || inside.split(sep)[0] === "") {
    throw new ReleaseError(`Artifact path escapes the staging directory: ${relativePath}`);
  }
  return absolute;
}

/**
 * Firma unos bytes con la clave privada.
 *
 * `openssl pkeyutl` con `-rawin` firma el contenido tal cual, que es
 * lo que necesita el verificador: la firma es sobre los bytes
 * **exactos**, sin normalizar nada.
 */
function signBytes(privateKeyPath, bytes, scratch) {
  const input = join(scratch, "input.bin");
  const signature = join(scratch, "signature.bin");
  writeFileSync(input, bytes);
  const result = spawnSync(
    "openssl",
    ["pkeyutl", "-sign", "-rawin", "-inkey", privateKeyPath, "-in", input, "-out", signature],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw new ReleaseError(`openssl is not available: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new ReleaseError(`openssl could not sign the data: ${result.stderr?.trim() ?? "unknown error"}`);
  }
  const signed = readFileSync(signature);
  return signed.toString("base64");
}

/** La firma de un fichero, sin cargarlo en memoria. */
function signFile(privateKeyPath, path, scratch) {
  const signature = join(scratch, "signature.bin");
  const result = spawnSync(
    "openssl",
    ["pkeyutl", "-sign", "-rawin", "-inkey", privateKeyPath, "-in", path, "-out", signature],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw new ReleaseError(`openssl is not available: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new ReleaseError(`openssl could not sign ${path}: ${result.stderr?.trim() ?? "unknown error"}`);
  }
  return readFileSync(signature).toString("base64");
}

/** Une la base pública con la ruta relativa del artefacto. */
function assetUrl(baseUrl, relativePath) {
  const segments = relativePath.split("/").map((segment) => encodeURIComponent(segment));
  return `${baseUrl.replace(/\/+$/, "")}/${segments.join("/")}`;
}

/** La versión de la app instalada, para el mínimo soportado por defecto. */
async function readCurrentVersion() {
  const raw = await readFile(join(REPO_ROOT, "packages", "desktop", "tauri.conf.json"), "utf8");
  const parsed = JSON.parse(raw);
  const version = parsed?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new ReleaseError("Could not read the app version from tauri.conf.json");
  }
  return version;
}

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
  if (args.out === undefined) {
    usage();
    throw new ReleaseError("`--out` is required");
  }

  // La clave privada se pide **por ruta**, nunca por valor. El valor
  // vive en el almacén de secretos del CI y sale de él un momento.
  const keyFromEnv = args.keyEnv === undefined ? undefined : process.env[args.keyEnv];
  const privateKeyPath = args.key ?? keyFromEnv;
  if (privateKeyPath === undefined || privateKeyPath.trim().length === 0) {
    throw new ReleaseError(
      "No signing key: pass `--key <file>` or `--key-env <var>` with the path of the private key",
    );
  }
  const privateKey = resolve(REPO_ROOT, privateKeyPath);

  const stage = resolve(REPO_ROOT, args.stage);
  const out = resolve(REPO_ROOT, args.out);
  const manifestPath = args.manifest === undefined
    ? join(stage, RELEASE_MANIFEST_FILE)
    : resolve(REPO_ROOT, args.manifest);

  const releaseManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const version = args.version ?? releaseManifest.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new ReleaseError("Could not determine the version to offer");
  }
  const minimumVersion = args.minimumVersion ?? (await readCurrentVersion());
  const baseUrl = args.baseUrl ?? `https://updates.tanit.dev/releases/${version}`;

  const artifacts = Array.isArray(releaseManifest.artifacts) ? releaseManifest.artifacts : [];
  if (artifacts.length === 0) {
    throw new ReleaseError(`The release manifest has no artifacts: ${manifestPath}`);
  }

  const scratch = await mkdtemp(join(tmpdir(), "tanit-updater-"));
  const targets = [];
  try {
    for (const artifact of artifacts) {
      const { os, arch, bundle, path: artifactPath, sha256 } = artifact;
      if (!KNOWN_OS.includes(os) || !KNOWN_ARCH.includes(arch) || !KNOWN_BUNDLES.includes(bundle)) {
        throw new ReleaseError(
          `Unknown target ${os}/${arch}/${bundle}: the updater cannot offer what it cannot name`,
        );
      }
      const absolute = resolveInside(stage, artifactPath);
      const found = await sha256File(absolute);
      if (typeof sha256 === "string" && sha256.length > 0 && found !== sha256.toLowerCase()) {
        throw new ReleaseError(
          `The artifact ${artifactPath} does not match the release manifest digest ` +
            `(${found} against ${sha256}). The staging changed after it was signed.`,
        );
      }
      targets.push({
        os,
        arch,
        bundle,
        url: assetUrl(baseUrl, artifactPath),
        sha256: found,
        signature: signFile(privateKey, absolute, scratch),
        size: await sizeOf(absolute),
      });
    }

    const manifest = {
      schema: UPDATE_MANIFEST_SCHEMA,
      version,
      minimumSupportedVersion: minimumVersion,
      generatedAt: new Date().toISOString(),
      publicKeyId: args.keyId,
      signatureAlgorithm: UPDATE_SIGNATURE_ALGORITHM,
      targets,
      provenance: {
        source: args.source ?? "release-desktop",
        ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
        ...(args.commit === undefined ? {} : { commit: args.commit }),
        builtAt: new Date().toISOString(),
      },
    };

    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    const input = join(scratch, "manifest.json");
    await writeFile(input, serialized, "utf8");
    const signature = signBytes(privateKey, serialized, scratch);

    await mkdir(out, { recursive: true });
    await writeFile(join(out, UPDATE_MANIFEST_FILE), serialized, "utf8");
    await writeFile(join(out, UPDATE_SIGNATURE_FILE), `${signature}\n`, "utf8");

    console.log(`→ Update manifest written: ${join(out, UPDATE_MANIFEST_FILE)}`);
    console.log(`→ Update signature written: ${join(out, UPDATE_SIGNATURE_FILE)}`);
    console.log(`   version ${version}, minimum supported ${minimumVersion}, key ${args.keyId}`);
    console.log(`   ${targets.length} target(s): ${targets.map((t) => `${t.os}/${t.arch}/${t.bundle}`).join(", ")}`);
    return 0;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof ReleaseError) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  console.error(`✗ ${error?.message ?? String(error)}`);
  process.exit(1);
}
