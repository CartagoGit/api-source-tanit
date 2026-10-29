#!/usr/bin/env bun
/**
 * `bun run scripts/release/prepare-artifacts.mjs` — el manifest efímero.
 *
 * Mide los artefactos que han salido del staging y escribe
 * `release-manifest.json`: versión semver, sistema, arquitectura,
 * formato, ruta relativa, SHA-256, firma, signer/key id y las
 * referencias de SBOM y provenance.
 *
 * ## Por qué el manifest es efímero
 *
 * No es un formato que alguien publique y que otro tenga que
 * interpretar: es **la medición** de los ficheros que hay en el
 * staging, en este momento. Publicarlo como contrato lo convertiría
 * en algo que puede quedarse viejo sin que nadie se entere, y un
 * manifest viejo es peor que no tener manifest: parece una garantía y
 * no lo es.
 *
 * Por eso el manifest se regenera en cada release y `verify-signature.sh`
 * lo vuelve a leer **recalculando todo** desde los assets. Si un
 * digest no cuadra, la release no sale.
 *
 * ## Qué se falla cerrado
 *
 *   · Un fichero del staging que el manifest no describe → error.
 *   · Un artefacto sin firma, en modo producción → error.
 *   · Un target de la matriz que no está, en modo producción → error.
 *   · Una credencial que falta, con `release.sign=true` → error.
 *   · Dos artefactos con la misma ruta → error (hash duplicado).
 *
 * ## El layout del staging
 *
 *     <stage>/<os>/<arch>/<bundle>/<instalador>
 *     <stage>/<os>/<arch>/<bundle>/<instalador>.sig
 *     <stage>/<os>/<arch>/<bundle>/<instalador>.signature.json
 *     <stage>/<os>/<arch>/checksums/SHA256SUMS[.sig][.signature.json]
 *     <stage>/<os>/<arch>/keyring/<keyring>.gpg
 *     <stage>/<os>/<arch>/sbom/<sbom>.cdx.json
 *     <stage>/<os>/<arch>/provenance/<attestation>.intoto.jsonl
 *
 * El `<os>/<arch>` va en la ruta y no sólo en el manifest a propósito:
 * el manifest dice qué **debería** haber, y la ruta dice qué **hay**.
 * Cuando los dos no coinciden, el verificador lo nota sin tener que
 * interpretar nombres de fichero.
 *
 * Uso:
 *   bun run scripts/release/prepare-artifacts.mjs --stage <dir>
 *   bun run scripts/release/prepare-artifacts.mjs --check-credentials --os linux
 *   bun run scripts/release/prepare-artifacts.mjs --dry-run --stage <dir>
 *   bun run scripts/release/prepare-artifacts.mjs --merge <dir> --manifest <file>
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import {
  RELEASE_BUNDLE_FILE_SUFFIX,
  RELEASE_CHECKSUMS_FILE,
  RELEASE_DETACHED_SIGNATURE_SUFFIX,
  RELEASE_MANIFEST_FILE,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_RECEIPT_SUFFIX,
  RELEASE_SIGN_DEFAULT,
  RELEASE_TARGET_MATRIX,
  SIGNING_PROVIDERS,
} from "../../packages/contracts/constants/release/signing.constant.js";

/** Los `os` que la release cubre. */
const KNOWN_OS = ["macos", "windows", "linux"];
/** Las arquitecturas que la release cubre. */
const KNOWN_ARCH = ["x64", "arm64"];
/** Los formatos de instalador, en el orden en que se comprueban. */
const KNOWN_BUNDLES = Object.keys(RELEASE_BUNDLE_FILE_SUFFIX);
/** Las carpetas del staging que llevan assets y no instaladores. */
const KNOWN_ASSET_DIRS = ["checksums", "keyring", "sbom", "provenance", "attestation"];

/** Error con mensaje para la persona que lee, no para el log. */
class ReleaseError extends Error {}

/**
 * Lee los argumentos de la línea de órdenes.
 *
 * Se declara a mano y no con un parser: son diez opciones y un
 * parser añade un fichero que nadie va a leer.
 */
function parseArgs(argv) {
  const args = {
    stage: undefined,
    manifest: undefined,
    version: undefined,
    config: undefined,
    os: undefined,
    arch: undefined,
    checkCredentials: false,
    production: false,
    dryRun: false,
    merge: undefined,
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
      case "--version": args.version = next(); break;
      case "--config": args.config = next(); break;
      case "--os": args.os = next(); break;
      case "--arch": args.arch = next(); break;
      case "--merge": args.merge = next(); break;
      case "--check-credentials": args.checkCredentials = true; break;
      case "--production": args.production = true; break;
      case "--dry-run": args.dryRun = true; break;
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
      "prepare-artifacts — build the ephemeral release manifest.",
      "",
      "  --stage <dir>            staging directory with the built artifacts",
      "  --manifest <file>        where to write the manifest",
      "  --version <semver>       release version (default: tauri.conf.json)",
      "  --config <file>          delendai.config.json (default: repo root)",
      "  --os <os>                only this operating system",
      "  --arch <arch>            only this architecture",
      "  --check-credentials      audit the signing credentials and exit",
      "  --production             require signing to be enabled and complete",
      "  --dry-run                materialize the expected artifact set",
      "  --merge <dir>            merge per-platform manifests found in <dir>",
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

/** La versión semver de la release, leída de la config de Tauri. */
async function readTauriVersion() {
  const raw = await readFile(join(REPO_ROOT, "packages", "desktop", "tauri.conf.json"), "utf8");
  const parsed = JSON.parse(raw);
  const version = parsed?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new ReleaseError("packages/desktop/tauri.conf.json has no `version`");
  }
  return version;
}

/** Si la release firma o no, según `delendai.config.json#release.sign`. */
async function readSignPolicy(configPath) {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return { sign: RELEASE_SIGN_DEFAULT, present: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ReleaseError(`Could not parse ${configPath}: ${error.message}`);
  }
  const release = parsed?.release;
  if (release === undefined) return { sign: RELEASE_SIGN_DEFAULT, present: false };
  if (release === null || typeof release !== "object") {
    throw new ReleaseError(`${configPath}#release must be an object`);
  }
  if (release.sign !== undefined && typeof release.sign !== "boolean") {
    throw new ReleaseError(`${configPath}#release.sign must be a boolean`);
  }
  return { sign: release.sign ?? RELEASE_SIGN_DEFAULT, present: true };
}

/**
 * Audita las credenciales de los proveedores de las plataformas pedidas.
 *
 * Devuelve **nombres**, nunca valores: un error que imprimiese el
 * valor de una credencial lo dejaría en el log de CI, que es público.
 */
function auditCredentials(osFilter) {
  const providers = SIGNING_PROVIDERS.filter(
    (provider) => osFilter === undefined || provider.os === osFilter,
  );
  return providers.map((provider) => {
    const missing = [];
    const present = [];
    for (const name of provider.requiredEnv) {
      const value = process.env[name];
      if (value === undefined || value.trim() === "") missing.push(name);
      else present.push(name);
    }
    for (const name of provider.optionalEnv) {
      const value = process.env[name];
      if (value !== undefined && value.trim() !== "") present.push(name);
    }
    return { provider: provider.id, os: provider.os, ok: missing.length === 0, missing, present };
  });
}

/** Imprime la auditoría de credenciales y dice si se puede firmar. */
function reportCredentials(audits) {
  console.log("→ Signing credentials:");
  for (const audit of audits) {
    if (audit.ok) {
      console.log(`   ✔ ${audit.provider.padEnd(8)} ready (${audit.present.join(", ") || "no optional variables"})`);
    } else {
      console.log(`   ✗ ${audit.provider.padEnd(8)} missing: ${audit.missing.join(", ")}`);
    }
  }
  return audits.every((audit) => audit.ok);
}

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
    // se publica su contenido fichero a fichero —se publica el
    // bundle comprimido—, así que sus ficheros no se miden.
    if (entry.isDirectory() && entry.name.endsWith(".app")) continue;
    if (entry.isDirectory()) await collectFiles(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

/** El bundle al que pertenece un nombre de fichero, o `undefined`. */
function bundleOf(fileName) {
  const matches = KNOWN_BUNDLES.filter((bundle) =>
    fileName.endsWith(RELEASE_BUNDLE_FILE_SUFFIX[bundle]),
  );
  // El sufijo más largo gana: `Tanit.app.zip` es `app`, no `zip`.
  matches.sort((a, b) => RELEASE_BUNDLE_FILE_SUFFIX[b].length - RELEASE_BUNDLE_FILE_SUFFIX[a].length);
  return matches[0];
}

/**
 * Qué es un fichero del staging.
 *
 * Devuelve `{ kind, os, arch, bundle, owner }`:
 *
 *   · `kind: "artifact"` — un instalador.
 *   · `kind: "asset"`    — checksums, keyring, sbom, provenance.
 *   · `kind: "receipt"`  — el recibo de la firma de otro artefacto.
 *   · `kind: "signature"`— una firma detached de otro artefacto.
 *   · `kind: "unknown"`  — no se sabe qué es, y por tanto no se publica.
 */
function classify(relPath) {
  const parts = relPath.split("/");
  const fileNameOnly = parts[parts.length - 1];

  // El manifest vive en el staging y no se describe a sí mismo.
  if (fileNameOnly === RELEASE_MANIFEST_FILE) return { kind: "manifest", relPath };

  if (parts.length < 4) return { kind: "unknown", relPath };

  const [os, arch, third] = parts;
  if (!KNOWN_OS.includes(os) || !KNOWN_ARCH.includes(arch)) return { kind: "unknown", relPath };

  const rest = parts.slice(3);
  const fileName = rest[rest.length - 1];
  // La carpeta que contiene el fichero, relativa a la plataforma:
  // `linux/x64/appimage/Tanit.deb` -> `appimage`.
  const inner = rest.slice(0, -1);
  const owner = inner.length > 0 ? `${third}/${inner.join("/")}` : third;

  if (KNOWN_ASSET_DIRS.includes(third)) {
    // En `checksums/` conviven el fichero de checksums, su firma
    // detached y el recibo de esa firma. Los tres son del mismo
    // asset —el que va firmado—, y el recibo no es un asset: es la
    // prueba de la firma, como el de un instalador.
    if (third === "checksums") {
      if (fileName.endsWith(RELEASE_RECEIPT_SUFFIX)) {
        return { kind: "receipt", os, arch, owner, relPath };
      }
      const assetKind = fileName.endsWith(RELEASE_DETACHED_SIGNATURE_SUFFIX)
        ? "checksums-signature"
        : "checksums";
      return { kind: "asset", assetKind, os, arch, owner, relPath };
    }
    // `kind` dice **qué es** (un asset) y `assetKind` **cuál** (el
    // keyring, los checksums, el SBOM…). Son dos cosas distintas y
    // confundirlas hacía que los assets no aparecieran en el manifest.
    return { kind: "asset", assetKind: third, os, arch, owner, relPath };
  }

  // Un recibo o una firma detached cuelgan del artefacto que firman:
  // el bundle se deduce del nombre **sin** el sufijo, porque
  // `Tanit.deb.signature.json` no acaba en `.deb`.
  let base = fileName;
  let kind = "artifact";
  if (fileName.endsWith(RELEASE_RECEIPT_SUFFIX)) {
    base = fileName.slice(0, -RELEASE_RECEIPT_SUFFIX.length);
    kind = "receipt";
  } else if (fileName.endsWith(RELEASE_DETACHED_SIGNATURE_SUFFIX)) {
    base = fileName.slice(0, -RELEASE_DETACHED_SIGNATURE_SUFFIX.length);
    kind = "signature";
  }

  const bundle = bundleOf(base);
  if (bundle === undefined) return { kind: "unknown", relPath };

  return { kind, os, arch, bundle, owner, relPath };
}

/** La ruta del artefacto al que pertenece un recibo o una firma. */
function ownerPath(entry) {
  const fileName = entry.relPath.split("/").pop();
  const prefix = `${entry.os}/${entry.arch}/${entry.owner}`;
  if (fileName.endsWith(RELEASE_RECEIPT_SUFFIX)) {
    return `${prefix}/${fileName.slice(0, -RELEASE_RECEIPT_SUFFIX.length)}`;
  }
  if (fileName.endsWith(RELEASE_DETACHED_SIGNATURE_SUFFIX)) {
    return `${prefix}/${fileName.slice(0, -RELEASE_DETACHED_SIGNATURE_SUFFIX.length)}`;
  }
  return entry.relPath;
}

/** El recibo de firma de un artefacto, si existe. */
async function readReceipt(stage, relPath) {
  const receiptPath = join(stage, `${relPath}${RELEASE_RECEIPT_SUFFIX}`);
  try {
    const raw = await readFile(receiptPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** El asset al que pertenece un SBOM o un attestation, por su nombre. */
function assetForTriple(assets, kind, os, arch) {
  const matching = assets.filter(
    (asset) => asset.kind === kind && asset.path.includes(`-${os}-${arch}`),
  );
  if (matching.length > 0) return matching[0];
  const global = assets.filter((asset) => asset.kind === kind && !/-[a-z]+-(x64|arm64)\./.test(asset.path));
  return global.length === 1 ? global[0] : null;
}

/**
 * Construye el manifest a partir del staging.
 *
 * Es una función aparte porque el merger y el generador hacen lo mismo
 * con distinta fuente: aquí se lee del disco, allí se leen fragmentos.
 */
async function buildManifest(stage, version, filters) {
  const files = await collectFiles(stage);
  const entries = files.map(classify);
  const present = new Set(files);

  const unknown = entries.filter((entry) => entry.kind === "unknown");
  if (unknown.length > 0) {
    throw new ReleaseError(
      `The staging contains ${unknown.length} file(s) the manifest cannot describe:\n` +
        unknown.map((entry) => `  · ${entry.relPath}`).join("\n") +
        "\n  Every published file has to be described, or the verifier cannot tell\n" +
        "  a signed artifact from a leftover.",
    );
  }

  const receipts = new Map();
  for (const entry of entries.filter((e) => e.kind === "receipt")) {
    receipts.set(ownerPath(entry), entry.relPath);
  }
  const detached = new Map();
  for (const entry of entries.filter((e) => e.kind === "signature")) {
    detached.set(ownerPath(entry), entry.relPath);
  }

  const artifacts = [];
  for (const entry of entries.filter((e) => e.kind === "artifact")) {
    if (filters.os !== undefined && entry.os !== filters.os) continue;
    if (filters.arch !== undefined && entry.arch !== filters.arch) continue;

    const artifactPath = join(stage, entry.relPath);
    const sha256 = await sha256File(artifactPath);
    const receipt = await readReceipt(stage, entry.relPath);

    let signature = null;
    if (receipt !== null) {
      const signaturePath = detached.get(entry.relPath) ?? entry.relPath;
      signature = {
        kind: receipt.kind,
        path: signaturePath,
        signer: receipt.signer,
        keyId: receipt.keyId,
        timestamped: receipt.timestamped === true,
        ...(receipt.notarized === undefined ? {} : { notarized: receipt.notarized }),
        ...(receipt.stapled === undefined ? {} : { stapled: receipt.stapled }),
        receipt: receipts.get(entry.relPath) ?? null,
      };
    }

    artifacts.push({
      version,
      os: entry.os,
      arch: entry.arch,
      bundle: entry.bundle,
      path: entry.relPath,
      sha256,
      signature,
    });
  }

  const assets = [];
  for (const entry of entries.filter((e) => e.kind === "asset")) {
    if (filters.os !== undefined && entry.os !== filters.os) continue;
    if (filters.arch !== undefined && entry.arch !== filters.arch) continue;
    const sha256 = await sha256File(join(stage, entry.relPath));

    // `SHA256SUMS` va firmado: su firma detached y su recibo cuelgan de
    // él. Sin esto, la firma se produce y se publica, pero el manifest
    // no dice quién la hizo — y el verificador no tiene nada que
    // comprobar.
    let signature = null;
    if (entry.assetKind === "checksums") {
      const signaturePath = `${entry.relPath}${RELEASE_DETACHED_SIGNATURE_SUFFIX}`;
      const receiptPath = `${entry.relPath}${RELEASE_RECEIPT_SUFFIX}`;
      const receipt = await readReceipt(stage, entry.relPath);
      if (receipt !== null && present.has(signaturePath)) {
        signature = {
          kind: receipt.kind,
          path: signaturePath,
          signer: receipt.signer,
          keyId: receipt.keyId,
          timestamped: receipt.timestamped === true,
          receipt: receiptPath,
        };
      }
    }

    assets.push({ kind: entry.assetKind, path: entry.relPath, sha256, signature });
  }

  // Los assets se enlazan a los artefactos por convención de nombre:
  // un SBOM con `-macos-x64` en el nombre cubre a los de macOS x64.
  const withRefs = artifacts.map((artifact) => {
    const sbom = assetForTriple(assets, "sbom", artifact.os, artifact.arch);
    const provenance = assetForTriple(assets, "provenance", artifact.os, artifact.arch);
    return {
      ...artifact,
      sbom: sbom === null ? null : { path: sbom.path, sha256: sbom.sha256 },
      provenance: provenance === null ? null : { path: provenance.path, sha256: provenance.sha256 },
    };
  });

  const seen = new Set();
  for (const artifact of withRefs) {
    if (seen.has(artifact.path)) {
      throw new ReleaseError(`Duplicated artifact path in the staging: ${artifact.path}`);
    }
    seen.add(artifact.path);
  }

  return {
    schema: RELEASE_MANIFEST_SCHEMA,
    version,
    generatedAt: new Date().toISOString(),
    artifacts: withRefs,
    assets,
  };
}

/**
 * Materializa el conjunto de artefactos esperado, sin compilar nada.
 *
 * Es el dry-run del DoD: produce **todos** los instaladores que la
 * matriz declara, con contenido de fixture, para poder medir el
 * manifest y pasar los verificadores sin un certificado de Apple ni de
 * Microsoft.
 *
 * Los de Linux **se firman de verdad**: con una clave GPG temporal
 * generada aquí mismo, en un directorio temporal, sin red y sin tocar
 * el keyring de quien lo ejecuta. Así el staging del dry-run es
 * verificable de verdad —`verify-signature.sh` acepta los artefactos
 * de Linux contra el keyring publicado— en vez de describir ocho
 * artefactos sin firmar.
 *
 * Los de macOS y Windows no se pueden firmar en una máquina Linux, y
 * el manifest lo dice con `signature: null` en vez de fingir una
 * firma: sus verificadores fallan cerrados, que es lo correcto.
 */
async function materializeDryRun(stage, version) {
  const created = [];
  for (const target of RELEASE_TARGET_MATRIX) {
    const bundleDir = join(stage, target.os, target.arch, target.bundle);
    await mkdir(bundleDir, { recursive: true });
    const suffix = RELEASE_BUNDLE_FILE_SUFFIX[target.bundle];
    // El nombre lleva la versión y la arquitectura porque la release
    // adjunta los assets por su `basename`: dos assets con el mismo
    // nombre se pisan al subirlos, y el bundle de macOS se llama
    // igual en las dos arquitecturas si no se le pone el nombre.
    const fileName = `Tanit_${version}_${target.arch}${suffix}`;
    const full = join(bundleDir, fileName);
    const body =
      `tanit release fixture\nversion=${version}\nos=${target.os}\narch=${target.arch}\n` +
      `bundle=${target.bundle}\n`;
    await writeFile(full, body, "utf8");
    created.push(full);
  }
  console.log(`→ Dry run: ${created.length} artifact(s) materialized under ${stage}`);
  await signDryRunLinux(stage);
  return created;
}

/**
 * Firma de verdad los artefactos de Linux del dry-run.
 *
 * La clave es efímera y local: se genera en un directorio temporal, no
 * toca el keyring de quien lo ejecuta y no sale a la red. Si `gpg` no
 * está, el dry-run sigue: lo dice, y los artefactos quedan sin firmar.
 */
async function signDryRunLinux(stage) {
  const probe = spawnSync("gpg", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log("→ Dry run: gpg is not available, the Linux artifacts stay unsigned");
    return false;
  }

  const home = await mkdtemp(join(tmpdir(), "tanit-dryrun-gnupg-"));
  const keyFile = join(home, "release-keyring.gpg");
  const env = { ...process.env, GNUPGHOME: home };

  try {
    const generated = spawnSync(
      "gpg",
      [
        "--batch",
        "--yes",
        "--no-tty",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        "--quick-generate-key",
        "Tanit Release Dry Run <dry-run@example.invalid>",
        "default",
        "default",
        "never",
      ],
      { encoding: "utf8", input: "\n", env },
    );
    if (generated.status !== 0) {
      console.log("→ Dry run: the throwaway GPG key could not be generated, the Linux artifacts stay unsigned");
      return false;
    }

    const listed = spawnSync("gpg", ["--list-keys", "--with-colons"], { encoding: "utf8", env });
    let keyId = "";
    for (const line of (listed.stdout ?? "").split("\n")) {
      if (line.startsWith("fpr:")) {
        keyId = line.split(":")[9] ?? "";
        break;
      }
    }
    if (keyId === "") {
      console.log("→ Dry run: the throwaway GPG key has no fingerprint, the Linux artifacts stay unsigned");
      return false;
    }

    const exported = spawnSync(
      "gpg",
      [
        "--batch",
        "--yes",
        "--no-tty",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        "--export-secret-keys",
        keyId,
      ],
      { input: "\n", env },
    );
    if (exported.status !== 0 || exported.stdout === undefined) {
      console.log("→ Dry run: the throwaway GPG key could not be exported, the Linux artifacts stay unsigned");
      return false;
    }
    await writeFile(keyFile, exported.stdout);

    const signed = spawnSync(
      "bash",
      [
        join(REPO_ROOT, "scripts", "release", "sign-linux.sh"),
        "--stage",
        stage,
        "--os",
        "linux",
        "--arch",
        "x64",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TANIT_SIGN_GPG_KEY_ID: keyId,
          TANIT_SIGN_GPG_KEYRING: keyFile,
          TANIT_SIGN_GPG_PASSPHRASE: "",
        },
      },
    );
    if (signed.status !== 0) {
      throw new ReleaseError(
        `The dry run could not sign the Linux artifacts:\n${signed.stdout ?? ""}${signed.stderr ?? ""}`,
      );
    }
    console.log(`→ Dry run: the Linux artifacts are signed with a throwaway key (${keyId})`);
    return true;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** Mergea los manifest por plataforma que hay bajo un directorio. */
async function mergeManifests(dir, version) {
  const files = await collectFiles(dir);
  const manifests = files.filter((file) => file.endsWith(`/${RELEASE_MANIFEST_FILE}`) || file === RELEASE_MANIFEST_FILE);
  if (manifests.length === 0) {
    throw new ReleaseError(`No ${RELEASE_MANIFEST_FILE} found under ${dir}`);
  }

  const artifacts = [];
  const assets = [];
  for (const file of manifests) {
    const parsed = JSON.parse(await readFile(join(dir, file), "utf8"));
    if (parsed.schema !== RELEASE_MANIFEST_SCHEMA) {
      throw new ReleaseError(`${file}: unexpected manifest schema "${parsed.schema}"`);
    }
    if (parsed.version !== version) {
      throw new ReleaseError(`${file}: version "${parsed.version}" does not match "${version}"`);
    }
    for (const artifact of parsed.artifacts ?? []) artifacts.push(artifact);
    for (const asset of parsed.assets ?? []) assets.push(asset);
  }

  const seen = new Set();
  for (const artifact of artifacts) {
    if (seen.has(artifact.path)) {
      throw new ReleaseError(`Duplicated artifact path across platforms: ${artifact.path}`);
    }
    seen.add(artifact.path);
  }

  console.log(`→ Merged ${manifests.length} manifest(s): ${artifacts.length} artifact(s), ${assets.length} asset(s)`);
  return {
    schema: RELEASE_MANIFEST_SCHEMA,
    version,
    generatedAt: new Date().toISOString(),
    artifacts,
    assets,
  };
}

/**
 * Los targets de la matriz que el manifest no cubre.
 *
 * La matriz es lo que la release promete. Un manifest que no la cubre
 * describe otra release. Y el `fail_on_unmatched_files` del workflow no
 * lo detecta: un glob recursivo de `.dmg` sigue encontrando un `.dmg`
 * aunque falte el del otro brazo, así que la comprobación tiene que
 * ser explícita.
 */
function missingTargets(artifacts) {
  const covered = new Set(artifacts.map((artifact) => `${artifact.os}/${artifact.arch}/${artifact.bundle}`));
  return RELEASE_TARGET_MATRIX.filter(
    (target) => !covered.has(`${target.os}/${target.arch}/${target.bundle}`),
  );
}

/**
 * Las aserciones de producción.
 *
 * Falla cerrado: si falta un target de la matriz, o si un artefacto no
 * está firmado, la release no sale. Publicar menos de lo prometido es
 * peor que no publicar: quien descarga cree que tiene un binario para
 * su plataforma y no lo tiene.
 */
function assertProduction(manifest, policy, configPath) {
  if (!policy.sign) {
    console.error(
      "\n✗ Production publishing requires `release.sign=true` in " +
        `${configPath.replace(`${REPO_ROOT}/`, "")}. The release stops here.`,
    );
    return 1;
  }

  const missing = missingTargets(manifest.artifacts);
  if (missing.length > 0) {
    console.error(
      "\n✗ Production publishing requires every target of the matrix. Missing:\n" +
        missing.map((target) => `  · ${target.os}/${target.arch}/${target.bundle}`).join("\n"),
    );
    return 1;
  }

  const unsigned = manifest.artifacts.filter((artifact) => artifact.signature === null);
  if (unsigned.length > 0) {
    console.error(
      "\n✗ Production publishing requires every artifact to be signed. Unsigned:\n" +
        unsigned.map((artifact) => `  · ${artifact.path}`).join("\n"),
    );
    return 1;
  }

  return 0;
}

/** El punto de entrada. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }

  // La auditoría de credenciales no necesita staging: es la primera
  // comprobación que hace la pipeline, y la que decide si merece la
  // pena seguir.
  if (!args.merge && !args.stage && !args.checkCredentials) {
    usage();
    throw new ReleaseError("`--stage` is required");
  }

  const configPath = args.config === undefined
    ? join(REPO_ROOT, "delendai.config.json")
    : resolve(REPO_ROOT, args.config);
  const policy = await readSignPolicy(configPath);
  const version = args.version ?? (await readTauriVersion());
  const osFilter = args.os;
  const archFilter = args.arch;

  if (osFilter !== undefined && !KNOWN_OS.includes(osFilter)) {
    throw new ReleaseError(`Unknown os "${osFilter}". Valid: ${KNOWN_OS.join(", ")}`);
  }
  if (archFilter !== undefined && !KNOWN_ARCH.includes(archFilter)) {
    throw new ReleaseError(`Unknown arch "${archFilter}". Valid: ${KNOWN_ARCH.join(", ")}`);
  }

  console.log(`→ Release version: ${version}`);
  console.log(
    `→ Signing policy: ${policy.sign ? "enabled" : "disabled"} ` +
      `(${configPath.replace(`${REPO_ROOT}/`, "")}#release.sign)`,
  );

  if (args.checkCredentials) {
    // Antes de tocar nada: si faltan credenciales, la release para
    // aquí y no llega a construir un artefacto sin firmar.
    const audits = auditCredentials(osFilter);
    const ready = reportCredentials(audits);
    if (!policy.sign) {
      console.log("   Signing is disabled: the credential audit is informational only.");
      return 0;
    }
    if (!ready) {
      console.error(
        "\n✗ Signing is enabled and the credentials are incomplete. The release stops here,\n" +
          "  before anything is built or published.",
      );
      return 1;
    }
    console.log("\n✔ Every required credential is present.");
    return 0;
  }

  if (args.merge !== undefined) {
    const merged = await mergeManifests(resolve(REPO_ROOT, args.merge), version);
    const outPath = args.manifest === undefined
      ? join(resolve(REPO_ROOT, args.merge), RELEASE_MANIFEST_FILE)
      : resolve(REPO_ROOT, args.manifest);
    await writeFile(outPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    console.log(`→ Manifest written: ${outPath}`);
    if (args.production) {
      return assertProduction(merged, policy, configPath);
    }
    return 0;
  }

  const stage = resolve(REPO_ROOT, args.stage);
  if (args.dryRun) {
    await materializeDryRun(stage, version);
  }

  const manifest = await buildManifest(stage, version, { os: osFilter, arch: archFilter });
  const outPath = args.manifest === undefined ? join(stage, RELEASE_MANIFEST_FILE) : resolve(REPO_ROOT, args.manifest);
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const unsigned = manifest.artifacts.filter((artifact) => artifact.signature === null);
  console.log(`→ Manifest written: ${outPath}`);
  console.log(`   ${manifest.artifacts.length} artifact(s), ${manifest.assets.length} asset(s)`);
  if (unsigned.length > 0) {
    console.log(
      `   ${unsigned.length} artifact(s) without signature: ` +
        unsigned.map((artifact) => `${artifact.os}/${artifact.arch}/${artifact.bundle}`).join(", "),
    );
  }

  if (args.production) {
    return assertProduction(manifest, policy, configPath);
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
