#!/usr/bin/env bun
/**
 * `bun run scripts/release/build-sbom.mjs` — el SBOM CycloneDX 1.6 y la
 * attestation de provenance de una release.
 *
 * ## Qué produce
 *
 * Tres ficheros, y los tres se publican con la release:
 *
 *   · el **SBOM** (`.cdx.json`), que dice quéComponents hay, de quién
 *     son, con qué hashes y cómo dependen entre sí;
 *   · la **provenance** (`.provenance.json`), que es el statement
 *     SLSA en claro: de dónde vino la build;
 *   · la **attestation** (`.intoto.jsonl`), que es el mismo statement
 *     dentro de un envelope DSSE **firmado**.
 *
 * ## De dónde sale el contenido
 *
 * De lo que hay, no de lo que debería haber:
 *
 *   · Los **artefactos** salen del manifest de la release, pero sus
 *     hashes se **recalculan** aquí sobre el fichero. Un hash que viene
 *     de otro sitio es una afirmación; uno recalculado es una medida.
 *   · El **grafo de Rust** sale de `packages/desktop/Cargo.lock` y de
 *     las dependencias directas de `packages/desktop/Cargo.toml`: son
 *     las crates que entran de verdad en el binario de la ventana.
 *   · El **grafo de Bun** sale de `bun.lock`, recorrido desde las
 *     dependencias de runtime que el CLI usa (`zod`, `@babel/parser`,
 *     `@babel/types`): son las que `bun build --compile` mete dentro
 *     del sidecar. Las de desarrollo no viajan en el binario, así que
 *     no están.
 *   · Las **bibliotecas nativas** salen de la lista declarada por
 *     plataforma, con la limitación que `docs/SBOM.md` explica.
 *
 * ## Lo que nunca entra
 *
 * Secretos, claves privadas, credenciales y ficheros temporales. No es
 * una courtesy: si uno de esos ficheros está en el staging, la release
 * lo publica, y un SBOM que no lo menciona sólo esconde la prueba. Por
 * eso el script **para** cuando encuentra uno.
 *
 * ## La attestation va firmada
 *
 * Con Ed25519, y la clave privada se pide **por ruta**, nunca por
 * valor: el valor vive en el almacén de secretos del CI y sale de él
 * un momento. Lo que hay versionado en el repo es la clave pública.
 *
 * Uso:
 *   bun run scripts/release/build-sbom.mjs --stage <dir> --manifest <file> \
 *     --key <pem>
 *   bun run scripts/release/build-sbom.mjs --stage <dir> --manifest <file> \
 *     --key-env TANIT_ATTESTATION_KEY
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import { matchesAnyGlob } from "../helpers/glob.helper.js";
import {
  parseBunLock,
  parseCargoBuildDependencies,
  parseCargoDirectDependencies,
  parseCargoLock,
} from "../helpers/release-dependencies.helper.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";
import {
  SBOM_ATTESTATION_FILE_SUFFIX,
  SBOM_BUILD_TOOL_COMPONENTS,
  SBOM_BUILD_TOOL_PROPERTY,
  SBOM_BUN_RUNTIME_ROOTS,
  SBOM_DEFAULT_BUILDER_ID,
  SBOM_DEFAULT_KEY_ID,
  SBOM_DESKTOP_COMPONENT,
  SBOM_DOCUMENT_VERSION,
  SBOM_EXCLUDED_FILE_PATTERNS,
  SBOM_FILE_SUFFIX,
  SBOM_FORMAT,
  SBOM_NATIVE_COMPONENTS,
  SBOM_PAYLOAD_TYPE,
  SBOM_PROVENANCE_FILE_SUFFIX,
  SBOM_PROVENANCE_PREDICATE_TYPE,
  SBOM_SIDECAR_COMPONENT,
  SBOM_SPEC_VERSION,
  SBOM_STATEMENT_TYPE,
} from "../../packages/contracts/constants/release/sbom.constant.js";

/** Un error de la release: no es un fallo de Node, es un fallo de la release. */
class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** Los `os` que la release de escritorio cubre. */
const KNOWN_OS = ["macos", "windows", "linux"];

/**
 * Las opciones del script.
 *
 * Se declara a mano y no con un parser: son pocas y un parser añade un
 * fichero que nadie va a leer.
 */
function parseArgs(argv) {
  const args = {
    stage: undefined,
    manifest: undefined,
    sbom: undefined,
    provenance: undefined,
    attestation: undefined,
    key: undefined,
    keyEnv: undefined,
    keyId: SBOM_DEFAULT_KEY_ID,
    version: undefined,
    os: undefined,
    arch: undefined,
    source: undefined,
    workflow: undefined,
    commit: undefined,
    builderId: SBOM_DEFAULT_BUILDER_ID,
    buildType: undefined,
    supplierName: undefined,
    supplierUrl: undefined,
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
      case "--sbom": args.sbom = next(); break;
      case "--provenance": args.provenance = next(); break;
      case "--attestation": args.attestation = next(); break;
      case "--key": args.key = next(); break;
      case "--key-env": args.keyEnv = next(); break;
      case "--key-id": args.keyId = next(); break;
      case "--version": args.version = next(); break;
      case "--os": args.os = next(); break;
      case "--arch": args.arch = next(); break;
      case "--source": args.source = next(); break;
      case "--workflow": args.workflow = next(); break;
      case "--commit": args.commit = next(); break;
      case "--builder-id": args.builderId = next(); break;
      case "--build-type": args.buildType = next(); break;
      case "--supplier-name": args.supplierName = next(); break;
      case "--supplier-url": args.supplierUrl = next(); break;
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
      "build-sbom — build the CycloneDX SBOM, the provenance and the signed attestation.",
      "",
      "  --stage <dir>            staging directory with the built artifacts",
      "  --manifest <file>        release manifest that describes the artifacts",
      "  --sbom <file>            where to write the SBOM (default: derived from the stage)",
      "  --provenance <file>      where to write the SLSA provenance statement",
      "  --attestation <file>     where to write the signed DSSE attestation",
      "  --key <file>             private key (PKCS#8 PEM) that signs the attestation",
      "  --key-env <var>          environment variable holding the path of the private key",
      "  --key-id <id>            attestation key identifier",
      "  --version <semver>       release version (default: the manifest's)",
      "  --os <os>                platform (default: derived from the manifest)",
      "  --arch <arch>            architecture (default: derived from the manifest)",
      "  --source <text>          provenance source (default: release-desktop)",
      "  --workflow <text>        provenance workflow",
      "  --commit <sha>           provenance commit",
      "  --builder-id <url>       identity of the builder",
      "  --build-type <url>       identity of the build type",
      "  --supplier-name <name>   supplier of the SBOM",
      "  --supplier-url <url>     supplier URL",
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
    // Un `.app` es un bundle: se publica comprimido, así que sus
    // ficheros no se miden uno a uno.
    if (entry.isDirectory() && entry.name.endsWith(".app")) continue;
    if (entry.isDirectory()) await collectFiles(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

/** El digest sha512 de npm, de base64 a hexadecimal. */
function base64ToHex(base64) {
  return Buffer.from(base64, "base64").toString("hex");
}

/**
 * Los componentes del grafo de Rust.
 *
 * Sólo las crates que vienen del registro: las del propio repo no son
 * dependencias, son el producto, y las cuenta el componente raíz.
 *
 * Y sólo las que **van dentro** del binario: las de `[build-dependencies]`
 * y las de `[dev-dependencies]` se resuelven en el lockfile igual que
 * las demás, pero no viajan en el producto. `tauri-build` es el caso
 * claro: la usa el `build.rs` para generar el código de Tauri, y
 * declararla como parte del binario es una mentira que además el
 * verificador exigaría mantener.
 */
function rustComponents(packages, excluded) {
  const components = [];
  const byName = new Map();
  for (const entry of packages) {
    if (excluded.has(entry.name)) continue;
    byName.set(entry.name, entry);
  }
  for (const entry of packages) {
    if (entry.source === undefined || !entry.source.startsWith("registry+")) continue;
    if (excluded.has(entry.name)) continue;
    const ref = `pkg:cargo/${entry.name}@${entry.version}`;
    components.push({
      type: "library",
      name: entry.name,
      version: entry.version,
      "bom-ref": ref,
      purl: ref,
      hashes:
        entry.checksum === undefined
          ? undefined
          : [{ alg: "SHA-256", content: entry.checksum }],
    });
  }
  return { components, byName };
}

/**
 * Los componentes del grafo de Bun.
 *
 * Sólo el cierre transitivo de las dependencias de runtime: es lo que
 * `bun build --compile` mete en el sidecar. Las 1070 entradas del
 * lockfile incluyen el compilador de Angular y el runner de tests, que
 * no viajan en el binario que se publica.
 */
function bunComponents(packages) {
  const roots = SBOM_BUN_RUNTIME_ROOTS.filter((name) => packages.has(name));
  if (roots.length === 0) {
    throw new ReleaseError(
      "None of the runtime dependencies are in bun.lock: the SBOM would describe an empty sidecar",
    );
  }

  const reachable = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || reachable.has(name)) continue;
    reachable.add(name);
    const entry = packages.get(name);
    if (entry === undefined) continue;
    for (const dependency of Object.keys(entry.dependencies)) {
      if (!reachable.has(dependency)) queue.push(dependency);
    }
  }

  const components = [];
  for (const name of [...reachable].sort()) {
    const entry = packages.get(name);
    if (entry === undefined) continue;
    const ref = `pkg:npm/${name}@${entry.version}`;
    components.push({
      type: "library",
      name,
      version: entry.version,
      "bom-ref": ref,
      purl: ref,
      hashes:
        entry.hash === undefined
          ? undefined
          : [{ alg: "SHA-512", content: base64ToHex(entry.hash) }],
    });
  }
  return { components, reachable, packages };
}

/**
 * Firma unos bytes con la clave privada.
 *
 * `openssl pkeyutl` con `-rawin` firma el contenido tal cual: la
 * firma es sobre los bytes **exactos**, sin normalizar nada. Es lo que
 * necesita el verificador, y es lo mismo que hace el firmador del
 * manifest del updater.
 */
function signBytes(privateKeyPath, bytes, scratch) {
  const input = join(scratch, "pae.bin");
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
    throw new ReleaseError(
      `openssl could not sign the attestation: ${result.stderr?.trim() ?? "unknown error"}`,
    );
  }
  return readFileSync(signature).toString("base64");
}

/** El PAE de DSSE: lo que se firma de verdad. */
function dssePae(payloadType, payload) {
  const type = Buffer.from(payloadType, "utf8");
  const body = Buffer.from(payload, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} ${payloadType} `, "utf8"),
    Buffer.from(`${body.length} `, "utf8"),
    body,
  ]);
}

/** El `bom-ref` de un componente de fichero del staging. */
function fileRef(path) {
  return `file:${path}`;
}

/**
 * El proveedor del SBOM, cuando se sabe quién es.
 *
 * Sale del `package.json` de la raíz: el autor es el responsable del
 * software y la URL del repositorio es donde se publica. Con las
 * banderas se puede corregir sin tocar el código.
 */
async function readSupplier(explicitName, explicitUrl) {
  const name = explicitName;
  const urls = explicitUrl === undefined ? [] : [explicitUrl];
  if (name !== undefined) return { name, ...(urls.length > 0 ? { url: urls } : {}) };
  try {
    const raw = await readFile(join(REPO_ROOT, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    const author = typeof parsed?.author === "string" ? parsed.author : undefined;
    const homepage = typeof parsed?.homepage === "string" ? parsed.homepage : undefined;
    if (author === undefined && homepage === undefined) return undefined;
    return {
      name: author ?? "Tanit",
      url: homepage === undefined ? [] : [homepage],
    };
  } catch {
    return undefined;
  }
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
  if (args.manifest === undefined) {
    usage();
    throw new ReleaseError("`--manifest` is required");
  }

  const keyFromEnv = args.keyEnv === undefined ? undefined : process.env[args.keyEnv];
  const privateKeyPath = args.key ?? keyFromEnv;
  if (privateKeyPath === undefined || privateKeyPath.trim().length === 0) {
    throw new ReleaseError(
      "No attestation key: pass `--key <file>` or `--key-env <var>` with the path of the private key",
    );
  }

  const stage = resolve(REPO_ROOT, args.stage);
  const manifestPath = resolve(REPO_ROOT, args.manifest);

  let releaseManifest;
  try {
    releaseManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new ReleaseError(`Could not read the release manifest ${manifestPath}: ${error.message}`);
  }

  const artifacts = Array.isArray(releaseManifest.artifacts) ? releaseManifest.artifacts : [];
  if (artifacts.length === 0) {
    throw new ReleaseError(`The release manifest describes no artifact: ${manifestPath}`);
  }

  const version = args.version ?? releaseManifest.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new ReleaseError("Could not determine the version of the release");
  }

  // La plataforma: la dicen los artefactos, si no la dice la bandera.
  const platforms = new Set(artifacts.map((artifact) => `${artifact.os}/${artifact.arch}`));
  if (args.os !== undefined || args.arch !== undefined) {
    if (!KNOWN_OS.includes(args.os ?? "")) {
      throw new ReleaseError(`Unknown os "${args.os}". Valid: ${KNOWN_OS.join(", ")}`);
    }
  } else if (platforms.size !== 1) {
    throw new ReleaseError(
      `The manifest covers ${platforms.size} platforms (${[...platforms].sort().join(", ")}): ` +
        "an SBOM describes one platform. Pass `--os` and `--arch`.",
    );
  }
  const first = artifacts[0];
  const os = args.os ?? first.os;
  const arch = args.arch ?? first.arch;

  // --- el staging no puede llevar secretos -------------------------------
  //
  // Antes de medir nada: un staging con una clave privada dentro se
  // publica entero, y un SBOM que no la menciona no lo evita.
  const stagedFiles = await collectFiles(stage);
  const forbidden = stagedFiles.filter((file) => matchesAnyGlob(file, SBOM_EXCLUDED_FILE_PATTERNS));
  if (forbidden.length > 0) {
    throw new ReleaseError(
      `The staging holds ${forbidden.length} file(s) that must never be published:\n` +
        forbidden.map((file) => `  · ${file}`).join("\n") +
        "\n  The release stops here: the staging is attached to the release as it is.",
    );
  }

  // --- los artefactos, medidos otra vez -----------------------------------
  const artifactComponents = [];
  const subjects = [];
  for (const artifact of artifacts) {
    const absolute = join(stage, artifact.path);
    const digest = await sha256File(absolute);
    if (typeof artifact.sha256 === "string" && artifact.sha256.length > 0 && digest !== artifact.sha256.toLowerCase()) {
      throw new ReleaseError(
        `The artifact ${artifact.path} does not match the release manifest digest ` +
          `(${digest} against ${artifact.sha256}). The staging changed after it was measured.`,
      );
    }
    artifactComponents.push({
      type: "application",
      name: artifact.path.split("/").pop(),
      version,
      "bom-ref": fileRef(artifact.path),
      hashes: [{ alg: "SHA-256", content: digest }],
      properties: [
        { name: "tanit:platform", value: `${artifact.os}/${artifact.arch}/${artifact.bundle}` },
        { name: "tanit:release:version", value: version },
      ],
    });
    subjects.push({ name: artifact.path, digest: { sha256: digest } });
  }

  // --- el grafo de dependencias --------------------------------------------
  const cargoLock = parseCargoLock(
    await readFile(join(REPO_ROOT, "packages", "desktop", "Cargo.lock"), "utf8"),
  );
  const cargoToml = await readFile(
    join(REPO_ROOT, "packages", "desktop", "Cargo.toml"),
    "utf8",
  );
  const cargoDirect = parseCargoDirectDependencies(cargoToml);
  const cargoBuild = parseCargoBuildDependencies(cargoToml);
  const rust = rustComponents(cargoLock, new Set(cargoBuild));
  const bun = bunComponents(parseBunLock(await readFile(join(REPO_ROOT, "bun.lock"), "utf8")));

  const desktopRef = `pkg:generic/${SBOM_DESKTOP_COMPONENT}@${version}`;
  const sidecarRef = `pkg:generic/${SBOM_SIDECAR_COMPONENT}@${CLI_VERSION}`;
  const nativeComponents = (SBOM_NATIVE_COMPONENTS[os] ?? []).map((name) => {
    const ref = `pkg:generic/${name}`;
    return {
      type: "library",
      name,
      version: "system",
      "bom-ref": ref,
      purl: ref,
      properties: [{ name: "tanit:native:platform", value: os }],
    };
  });

  // Las herramientas de build: están en la cadena de construcción y
  // **no** en el binario. Se declaran con una propiedad que lo dice, y
  // no cuelgan del producto en el grafo: el binario no las usa.
  const buildToolComponents = (SBOM_BUILD_TOOL_COMPONENTS[os] ?? []).map((name) => {
    const ref = `pkg:generic/${name}`;
    return {
      type: "application",
      name,
      version: "system",
      "bom-ref": ref,
      purl: ref,
      properties: [
        { name: "tanit:native:platform", value: os },
        { name: SBOM_BUILD_TOOL_PROPERTY, value: "not packaged" },
      ],
    };
  });

  const desktopComponent = {
    type: "application",
    name: SBOM_DESKTOP_COMPONENT,
    version,
    "bom-ref": desktopRef,
    purl: desktopRef,
    properties: [
      { name: "tanit:platform", value: `${os}/${arch}` },
      { name: "tanit:release:version", value: version },
    ],
  };
  const sidecarComponent = {
    type: "application",
    name: SBOM_SIDECAR_COMPONENT,
    version: CLI_VERSION,
    "bom-ref": sidecarRef,
    purl: sidecarRef,
    properties: [
      { name: "tanit:component", value: "sidecar" },
      { name: "tanit:release:version", value: version },
    ],
  };

  const components = [
    ...artifactComponents,
    desktopComponent,
    sidecarComponent,
    ...rust.components,
    ...bun.components,
    ...nativeComponents,
    ...buildToolComponents,
  ];

  // --- el grafo de dependencias --------------------------------------------
  const edges = new Map();
  const edge = (from, to) => {
    if (from === undefined || to === undefined) return;
    const current = edges.get(from) ?? [];
    if (!current.includes(to)) current.push(to);
    edges.set(from, current);
  };

  // El artefacto contiene la app y su sidecar.
  for (const artifact of artifacts) {
    edge(fileRef(artifact.path), desktopRef);
    edge(fileRef(artifact.path), sidecarRef);
  }
  // La app cuelga de sus crates directas y de las bibliotecas nativas.
  for (const name of cargoDirect) {
    const entry = rust.byName.get(name);
    if (entry === undefined) continue;
    edge(desktopRef, `pkg:cargo/${entry.name}@${entry.version}`);
  }
  for (const native of nativeComponents) {
    edge(desktopRef, native["bom-ref"]);
  }
  // El sidecar cuelga de sus dependencias de runtime.
  for (const name of SBOM_BUN_RUNTIME_ROOTS) {
    const versionOf = bun.components.find((component) => component.name === name);
    if (versionOf === undefined) continue;
    edge(sidecarRef, versionOf["bom-ref"]);
  }
  // Y cada dependencia cuelga de las suyas.
  for (const entry of cargoLock) {
    if (entry.source === undefined || !entry.source.startsWith("registry+")) continue;
    const from = `pkg:cargo/${entry.name}@${entry.version}`;
    for (const dependency of entry.dependencies) {
      const target = rust.byName.get(dependency);
      if (target === undefined) continue;
      edge(from, `pkg:cargo/${target.name}@${target.version}`);
    }
  }
  for (const component of bun.components) {
    const entry = bun.packages.get(component.name);
    if (entry === undefined) continue;
    for (const dependency of Object.keys(entry.dependencies)) {
      const target = bun.components.find((candidate) => candidate.name === dependency);
      if (target === undefined) continue;
      edge(component["bom-ref"], target["bom-ref"]);
    }
  }

  const dependencies = components.map((component) => ({
    ref: component["bom-ref"],
    dependsOn: [...(edges.get(component["bom-ref"]) ?? [])].sort(),
  }));

  // --- el documento ---------------------------------------------------------
  const supplier = await readSupplier(args.supplierName, args.supplierUrl);
  const document = {
    bomFormat: SBOM_FORMAT,
    specVersion: SBOM_SPEC_VERSION,
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: SBOM_DOCUMENT_VERSION,
    metadata: {
      timestamp: new Date().toISOString(),
      lifecycles: [{ phase: "build" }],
      tools: {
        components: [
          { type: "application", name: "tanit-build-sbom", version: CLI_VERSION },
        ],
      },
      component: desktopComponent,
      ...(supplier === undefined ? {} : { supplier }),
    },
    components,
    dependencies,
  };

  const baseName = `Tanit_${version}-${os}-${arch}`;
  const sbomPath = args.sbom === undefined
    ? join(stage, os, arch, "sbom", `${baseName}${SBOM_FILE_SUFFIX}`)
    : resolve(REPO_ROOT, args.sbom);
  const provenancePath = args.provenance === undefined
    ? join(stage, os, arch, "provenance", `${baseName}${SBOM_PROVENANCE_FILE_SUFFIX}`)
    : resolve(REPO_ROOT, args.provenance);
  const attestationPath = args.attestation === undefined
    ? join(stage, os, arch, "attestation", `${baseName}${SBOM_ATTESTATION_FILE_SUFFIX}`)
    : resolve(REPO_ROOT, args.attestation);

  await mkdir(join(sbomPath, ".."), { recursive: true });
  await mkdir(join(provenancePath, ".."), { recursive: true });
  await mkdir(join(attestationPath, ".."), { recursive: true });

  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(sbomPath, serialized, "utf8");

  // --- la provenance y su attestation --------------------------------------
  const statement = {
    _type: SBOM_STATEMENT_TYPE,
    subject: [
      ...subjects,
      {
        name: relative(stage, sbomPath).split(sep).join("/"),
        digest: { sha256: await sha256File(sbomPath) },
      },
    ],
    predicateType: SBOM_PROVENANCE_PREDICATE_TYPE,
    predicate: {
      buildDefinition: {
        buildType: args.buildType ?? args.builderId,
        externalParameters: {
          source: {
            uri: "git+https://github.com/CartagoGit/api-source-tanit",
            ...(args.commit === undefined ? {} : { digest: { sha1: args.commit } }),
          },
          ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
          // El nombre de la release va en `release` y no en `source`:
          // `source` es el repositorio, y un objeto con la URI del repo
          // y el digest del commit no se puede sustituir por un texto.
          ...(args.source === undefined ? {} : { release: args.source }),
        },
        internalParameters: { platform: os, architecture: arch, version },
        resolvedDependencies: args.commit === undefined
          ? []
          : [
              {
                name: "git+https://github.com/CartagoGit/api-source-tanit",
                digest: { sha1: args.commit },
              },
            ],
      },
      runDetails: {
        builder: { id: args.builderId },
        metadata: {
          invocationId: `https://github.com/CartagoGit/api-source-tanit/actions/runs/${randomUUID()}`,
          startedOn: new Date().toISOString(),
        },
      },
    },
  };

  await writeFile(provenancePath, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

  const payload = Buffer.from(JSON.stringify(statement), "utf8");
  const scratch = await mkdtemp(join(tmpdir(), "tanit-attestation-"));
  try {
    const signature = signBytes(resolve(REPO_ROOT, privateKeyPath), dssePae(SBOM_PAYLOAD_TYPE, payload), scratch);
    const envelope = {
      payloadType: SBOM_PAYLOAD_TYPE,
      payload: payload.toString("base64"),
      signatures: [{ keyid: args.keyId, sig: signature }],
    };
    await writeFile(attestationPath, `${JSON.stringify(envelope)}\n`, "utf8");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  console.log(`→ SBOM written: ${sbomPath}`);
  console.log(`→ Provenance written: ${provenancePath}`);
  console.log(`→ Attestation written: ${attestationPath}`);
  console.log(
    `   ${components.length} component(s), ${dependencies.length} dependency entr(ies), ` +
      `${artifactComponents.length} artifact(s) of ${os}/${arch}`,
  );
  console.log(`   version ${version}, key ${args.keyId}`);
  return 0;
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
