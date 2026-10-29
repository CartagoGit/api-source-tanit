#!/usr/bin/env bun
/**
 * `bun run scripts/release/verify-sbom.mjs` — el verificador del SBOM.
 *
 * ## Qué pregunta
 *
 * Si el SBOM, la provenance y la attestation que se van a publicar
 * **describen los artefactos que se publican**. Y nada más: el
 * verificador no reescribe el SBOM, no lo completa y no perdona un
 * hueco. Dice qué no cuadra y sale con código 1.
 *
 * ## Las comprobaciones, en orden
 *
 *   1. **Schema**. Que el documento sea CycloneDX 1.6: `bomFormat`,
 *      `specVersion`, `serialNumber`, versión, metadatos, componentes y
 *      grafo. La validación es **estructural** —el subconjunto que
 *      1.6 exige—, no la validación contra el JSON Schema oficial: ese
 *      esquema vive en un CDN y este verificador tiene que funcionar
 *      sin red, en un runner aislado y en el portátil de quien audita.
 *   2. **Componentes requeridos**. La ventana y el sidecar: sin los
 *      dos, el documento no describe el producto.
 *   3. **Hashes**. Recalculados desde el staging, no copiados del
 *      documento. Un hash que el verificador se cree no comprueba nada.
 *   4. **Manifest de la release**. Versión y hash coinciden, por
 *      artefacto. Es la validación mutua de S2.
 *   5. **Manifest del updater**. Versión y hash coinciden, por destino.
 *      Es la validación mutua de S3.
 *   6. **Attestation**. Que exista, que su firma verifique contra la
 *      clave pública, que el `keyid` sea el esperado y que sus sujetos
 *      sean **este** SBOM y estos artefactos.
 *   7. **Provenance**. Que el statement sea SLSA y que diga el origen
 *      que se espera: una attestation de otra build no es una
 *      attestation.
 *
 * ## Por qué acepta varios SBOM
 *
 * Porque una release tiene un SBOM por plataforma, y la validación
 * contra el manifest de la release y contra el manifest del updater es
 * de **release entera**: cada SBOM se valida por su cuenta, pero el
 * conjunto se valida contra el conjunto. Un SBOM de Linux que no
 * menciona el `.msi` de Windows no está incompleto: está incompleto si
 * entre los dos no sale.
 *
 * ## Por qué falla cerrado
 *
 * Porque una attestation ausente o que no verifica **impide publicar**.
 * Un SBOM a medio validar es peor que no tener SBOM: parece una
 * garantía y no lo es.
 *
 * Uso:
 *   bun run scripts/release/verify-sbom.mjs --sbom <file> --attestation <file> \
 *     --stage <dir> --manifest <file> --public-key <file>
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import { matchesAnyGlob } from "../helpers/glob.helper.js";
import { parseCargoDirectDependencies } from "../helpers/release-dependencies.helper.js";
import {
  SBOM_BUN_RUNTIME_ROOTS,
  SBOM_DEFAULT_KEY_ID,
  SBOM_DESKTOP_COMPONENT,
  SBOM_EXCLUDED_FILE_PATTERNS,
  SBOM_FORMAT,
  SBOM_PAYLOAD_TYPE,
  SBOM_PROVENANCE_PREDICATE_TYPE,
  SBOM_REQUIRED_COMPONENTS,
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

/** Los problemas que se han ido acumulando. */
const problems = [];

/** Anota un problema si la condición no se cumple. */
function requireThat(condition, message) {
  if (!condition) problems.push(message);
  return condition;
}

/**
 * Las opciones del script.
 *
 * Se declara a mano y no con un parser: son pocas y un parser añade un
 * fichero que nadie va a leer.
 */
function parseArgs(argv) {
  const args = {
    sbom: [],
    attestation: [],
    stage: undefined,
    manifest: undefined,
    updateManifest: undefined,
    publicKey: undefined,
    keyId: SBOM_DEFAULT_KEY_ID,
    builderId: undefined,
    source: undefined,
    commit: undefined,
    requireUpdateManifest: false,
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
      case "--sbom": args.sbom.push(next()); break;
      case "--attestation": args.attestation.push(next()); break;
      case "--stage": args.stage = next(); break;
      case "--manifest": args.manifest = next(); break;
      case "--update-manifest": args.updateManifest = next(); break;
      case "--public-key": args.publicKey = next(); break;
      case "--key-id": args.keyId = next(); break;
      case "--builder-id": args.builderId = next(); break;
      case "--source": args.source = next(); break;
      case "--commit": args.commit = next(); break;
      case "--require-update-manifest": args.requireUpdateManifest = true; break;
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
      "verify-sbom — verify the SBOM, the provenance and the signed attestation.",
      "",
      "  --sbom <file>                SBOM to verify (repeatable)",
      "  --attestation <file>         attestation to verify (repeatable)",
      "  --stage <dir>                staging directory, to recompute the hashes",
      "  --manifest <file>            release manifest (mutual validation with S2)",
      "  --update-manifest <file>     update manifest (mutual validation with S3)",
      "  --public-key <file>          public key (PEM) that verifies the attestation",
      "  --key-id <id>                attestation key identifier expected",
      "  --builder-id <url>           builder identity expected in the provenance",
      "  --source <text>              provenance source expected",
      "  --commit <sha>               provenance commit expected",
      "  --require-update-manifest    fail when there is no update manifest to validate against",
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

/** ¿Es esto un objeto (y no un array ni un nulo)? */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ¿Es esto un digest hexadecimal? */
function isHexDigest(value, length) {
  if (typeof value !== "string") return false;
  if (value.length !== length) return false;
  return /^[0-9a-f]+$/.test(value);
}

/** El hash SHA-256 de un componente, si lo tiene. */
function sha256Of(component) {
  const hashes = Array.isArray(component?.hashes) ? component.hashes : [];
  const found = hashes.find((hash) => hash?.alg === "SHA-256");
  return typeof found?.content === "string" ? found.content : undefined;
}

/** Los `bom-ref` de los componentes que describen un fichero del staging. */
function fileRefsOf(document) {
  const refs = [];
  for (const component of Array.isArray(document?.components) ? document.components : []) {
    const ref = component?.["bom-ref"];
    if (typeof ref === "string" && ref.startsWith("file:")) refs.push(ref);
  }
  return refs;
}

/**
 * El PAE de DSSE: lo que se firma de verdad.
 *
 * La firma es sobre el payload **descodificado**, no sobre el texto
 * que viaja: por eso el base64 se deshace antes de reconstruir el PAE.
 */
function dssePae(payloadType, payload) {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} ${payloadType} `, "utf8"),
    Buffer.from(`${payload.length} `, "utf8"),
    payload,
  ]);
}

/**
 * Verifica una firma Ed25519 con la clave pública.
 *
 * `openssl pkeyutl -verify -rawin` es la forma de verificar Ed25519 con
 * la herramienta de la que ya depende el resto de la release: la misma
 * que firma el manifest del updater.
 */
function verifySignature(publicKeyPath, pae, signature, scratch) {
  const input = join(scratch, "pae.bin");
  const signatureFile = join(scratch, "signature.bin");
  writeFileSync(input, pae);
  writeFileSync(signatureFile, signature);
  const result = spawnSync(
    "openssl",
    [
      "pkeyutl",
      "-verify",
      "-rawin",
      "-pubin",
      "-inkey",
      publicKeyPath,
      "-in",
      input,
      "-sigfile",
      signatureFile,
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw new ReleaseError(`openssl is not available: ${result.error.message}`);
  }
  return result.status === 0;
}

/**
 * Valida la forma del documento contra el subconjunto que 1.6 exige.
 *
 * No es el JSON Schema oficial: es la lista de campos que 1.6 declara
 * obligatorios, comprobados aquí. La diferencia está documentada en
 * `docs/SBOM.md`, y es a propósito: este verificador tiene que
 * funcionar sin red.
 */
function validateSchema(document) {
  if (!isObject(document)) {
    problems.push("the SBOM is not a JSON object");
    return false;
  }
  requireThat(document.bomFormat === SBOM_FORMAT, `bomFormat must be "${SBOM_FORMAT}"`);
  requireThat(
    document.specVersion === SBOM_SPEC_VERSION,
    `specVersion must be "${SBOM_SPEC_VERSION}"`,
  );
  requireThat(
    typeof document.serialNumber === "string" && /^urn:uuid:[0-9a-f-]{36}$/.test(document.serialNumber),
    "serialNumber must be a urn:uuid",
  );
  requireThat(
    typeof document.version === "number" && Number.isInteger(document.version) && document.version >= 1,
    "version must be an integer greater than or equal to 1",
  );

  const metadata = document.metadata;
  if (!isObject(metadata)) {
    problems.push("metadata is missing");
  } else {
    requireThat(
      typeof metadata.timestamp === "string" && !Number.isNaN(Date.parse(metadata.timestamp)),
      "metadata.timestamp must be an ISO-8601 instant",
    );
    requireThat(isObject(metadata.component), "metadata.component is missing");
    requireThat(
      Array.isArray(metadata.lifecycles) && metadata.lifecycles.length > 0,
      "metadata.lifecycles is missing",
    );
    if (metadata.supplier !== undefined) {
      requireThat(isObject(metadata.supplier), "metadata.supplier must be an object");
      requireThat(
        typeof metadata.supplier?.name === "string" && metadata.supplier.name.length > 0,
        "metadata.supplier.name is missing",
      );
    }
  }

  const components = document.components;
  if (!Array.isArray(components) || components.length === 0) {
    problems.push("components is missing or empty");
    return false;
  }

  const refs = new Set();
  for (const component of components) {
    if (!isObject(component)) {
      problems.push("a component is not an object");
      continue;
    }
    const ref = component["bom-ref"];
    requireThat(
      typeof ref === "string" && ref.length > 0,
      `a component has no bom-ref: ${component.name ?? "?"}`,
    );
    requireThat(
      typeof component.name === "string" && component.name.length > 0,
      `a component has no name: ${ref ?? "?"}`,
    );
    requireThat(
      typeof component.type === "string" && component.type.length > 0,
      `the component ${ref ?? "?"} has no type`,
    );
    requireThat(
      typeof component.version === "string" && component.version.length > 0,
      `the component ${ref ?? "?"} has no version`,
    );
    if (typeof ref === "string") {
      requireThat(!refs.has(ref), `the bom-ref "${ref}" is used twice`);
      refs.add(ref);
    }
    for (const hash of Array.isArray(component.hashes) ? component.hashes : []) {
      requireThat(
        hash?.alg === "SHA-256" || hash?.alg === "SHA-512",
        `the component ${ref ?? "?"} declares an unknown hash algorithm`,
      );
      const length = hash?.alg === "SHA-256" ? 64 : 128;
      requireThat(
        isHexDigest(hash?.content, length),
        `the component ${ref ?? "?"} has a malformed ${hash?.alg ?? "?"} digest`,
      );
    }
  }

  const dependencies = document.dependencies;
  if (!Array.isArray(dependencies)) {
    problems.push("dependencies is missing");
    return false;
  }
  for (const entry of dependencies) {
    if (!isObject(entry)) {
      problems.push("a dependency entry is not an object");
      continue;
    }
    requireThat(typeof entry.ref === "string", "a dependency entry has no ref");
    requireThat(
      Array.isArray(entry.dependsOn),
      `the dependency ${entry.ref ?? "?"} has no dependsOn`,
    );
    if (typeof entry.ref === "string") {
      requireThat(refs.has(entry.ref), `the dependency "${entry.ref}" does not correspond to any component`);
    }
    for (const target of Array.isArray(entry.dependsOn) ? entry.dependsOn : []) {
      requireThat(
        refs.has(target),
        `the dependency "${entry.ref ?? "?"}" points at the unknown component "${target}"`,
      );
    }
  }

  // Los componentes que describen un fichero del staging se nombran con
  // la ruta: si esa ruta es un secreto, el SBOM lo está publicando.
  for (const component of components) {
    const ref = component?.["bom-ref"];
    if (typeof ref !== "string" || !ref.startsWith("file:")) continue;
    const path = ref.slice("file:".length);
    requireThat(
      !matchesAnyGlob(path, SBOM_EXCLUDED_FILE_PATTERNS),
      `the component "${path}" describes a file that must never be published`,
    );
  }

  return true;
}

/** Los componentes que el producto necesita, y que el SBOM tiene que llevar. */
function validateRequiredComponents(document) {
  const names = new Set(
    (Array.isArray(document?.components) ? document.components : []).map((component) => component?.name),
  );
  for (const required of SBOM_REQUIRED_COMPONENTS) {
    requireThat(names.has(required), `the SBOM does not describe the required component "${required}"`);
  }
}

/**
 * La cobertura del grafo: todo lo que el producto usa, declarado.
 *
 * Es la comprobación que hace que un SBOM incompleto no se publique.
 * El riesgo de publicar un SBOM al que le falta una dependencia es
 * mayor que el coste de regenerarlo: un SBOM incompleto no es un
 * inventario incompleto, es un inventario que **miente** sobre lo que
 * lleva el binario.
 *
 * Se comprueba contra las fuentes —el `Cargo.toml` del escritorio y las
 * raíces de runtime del sidecar—, no contra una lista escrita aquí: una
 * lista escrita aquí se queda vieja en cuanto alguien añade una
 * dependencia, y para entonces ya no comprueba nada.
 */
async function validateDependencyCoverage(document) {
  const components = Array.isArray(document?.components) ? document.components : [];
  const byName = new Map();
  for (const component of components) {
    if (typeof component?.name === "string") byName.set(component.name, component);
  }
  const edges = new Map();
  for (const entry of Array.isArray(document?.dependencies) ? document.dependencies : []) {
    if (typeof entry?.ref === "string") edges.set(entry.ref, entry.dependsOn ?? []);
  }

  const desktop = byName.get(SBOM_DESKTOP_COMPONENT);
  const sidecar = byName.get(SBOM_SIDECAR_COMPONENT);

  // El sidecar: sus dependencias de runtime tienen que estar, y el
  // grafo tiene que decir que cuelgan de él.
  for (const root of SBOM_BUN_RUNTIME_ROOTS) {
    const component = byName.get(root);
    requireThat(
      component !== undefined,
      `the SBOM does not describe the dependency "${root}" of the sidecar`,
    );
    if (component === undefined || sidecar === undefined) continue;
    requireThat(
      (edges.get(sidecar["bom-ref"]) ?? []).includes(component["bom-ref"]),
      `the sidecar does not depend on "${root}" in the dependency graph`,
    );
  }

  // El escritorio: sus crates directas tienen que estar, y el grafo
  // tiene que decir que cuelgan de él.
  let direct = [];
  try {
    direct = parseCargoDirectDependencies(
      await readFile(join(REPO_ROOT, "packages", "desktop", "Cargo.toml"), "utf8"),
    );
  } catch (error) {
    problems.push(`the desktop dependencies could not be read: ${error.message}`);
    return;
  }
  for (const crate of direct) {
    const component = byName.get(crate);
    requireThat(
      component !== undefined,
      `the SBOM does not describe the dependency "${crate}" of the desktop`,
    );
    if (component === undefined || desktop === undefined) continue;
    requireThat(
      (edges.get(desktop["bom-ref"]) ?? []).includes(component["bom-ref"]),
      `the desktop does not depend on "${crate}" in the dependency graph`,
    );
  }
}

/**
 * Los hashes del SBOM, recalculados desde el staging.
 *
 * El SBOM puede mentir: por eso el digest se vuelve a medir aquí. Un
 * hash que el verificador se cree no comprueba nada.
 */
async function validateHashes(document, stage) {
  if (stage === undefined) {
    console.log("→ No staging: the hashes of the artifacts are not recomputed.");
    return;
  }
  for (const ref of fileRefsOf(document)) {
    const path = ref.slice("file:".length);
    let digest;
    try {
      digest = await sha256File(join(stage, path));
    } catch {
      problems.push(`the component "${path}" is not in the staging`);
      continue;
    }
    const component = document.components.find((candidate) => candidate?.["bom-ref"] === ref);
    const declared = sha256Of(component);
    requireThat(
      declared !== undefined && declared === digest,
      `the component "${path}" does not match the staging: ${declared ?? "no digest"} against ${digest}`,
    );
  }
}

/**
 * La validación mutua con el manifest de la release.
 *
 * El manifest dice qué se publica; el SBOM dice qué contiene. Si los
 * dos no hablan del mismo artefacto con el mismo hash, uno de los dos
 * está mintiendo — y la release no sale.
 */
async function validateAgainstManifest(documents, union, manifestPath, stage) {
  if (manifestPath === undefined) return undefined;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    problems.push(`the release manifest could not be read: ${error.message}`);
    return undefined;
  }

  for (const artifact of Array.isArray(manifest.artifacts) ? manifest.artifacts : []) {
    const ref = `file:${artifact.path}`;
    const component = union.get(ref);
    if (component === undefined) {
      problems.push(`the SBOM does not cover the artifact ${artifact.path}`);
      continue;
    }
    const declared = sha256Of(component);
    requireThat(
      declared !== undefined && declared === artifact.sha256,
      `the SBOM and the release manifest disagree about ${artifact.path}: ` +
        `${declared ?? "no digest"} against ${artifact.sha256}`,
    );
    requireThat(
      component.version === artifact.version,
      `the SBOM and the release manifest disagree about the version of ${artifact.path}: ` +
        `${component.version} against ${artifact.version}`,
    );
  }

  for (const { document } of documents) {
    requireThat(
      document?.metadata?.component?.version === manifest.version,
      `the SBOM describes the version ${document?.metadata?.component?.version} and the release manifest ` +
        `the version ${manifest.version}`,
    );
  }

  if (stage !== undefined) {
    for (const artifact of Array.isArray(manifest.artifacts) ? manifest.artifacts : []) {
      const absolute = join(stage, artifact.path);
      let digest;
      try {
        digest = await sha256File(absolute);
      } catch {
        problems.push(`the release manifest describes ${artifact.path}, which is not in the staging`);
        continue;
      }
      requireThat(
        digest === artifact.sha256,
        `the artifact ${artifact.path} does not match the release manifest: ${digest} against ${artifact.sha256}`,
      );
    }
  }

  return manifest;
}

/**
 * La validación mutua con el manifest del updater (S3).
 *
 * El updater ofrece una URL y un hash; el SBOM dice qué hay dentro. Si
 * el hash que ofrece el updater no es el hash de un artefacto que el
 * SBOM describe, el updater está ofreciendo algo que el SBOM no
 * declara.
 */
async function validateAgainstUpdateManifest(union, updateManifestPath, releaseManifest) {
  if (updateManifestPath === undefined) return undefined;
  let updateManifest;
  try {
    updateManifest = JSON.parse(await readFile(updateManifestPath, "utf8"));
  } catch (error) {
    problems.push(`the update manifest could not be read: ${error.message}`);
    return undefined;
  }

  if (releaseManifest !== undefined) {
    requireThat(
      updateManifest.version === releaseManifest.version,
      `the update manifest offers the version ${updateManifest.version} and the release manifest ` +
        `the version ${releaseManifest.version}`,
    );
  }

  for (const target of Array.isArray(updateManifest.targets) ? updateManifest.targets : []) {
    const artifact = (Array.isArray(releaseManifest?.artifacts) ? releaseManifest.artifacts : []).find(
      (candidate) =>
        candidate.os === target.os &&
        candidate.arch === target.arch &&
        candidate.bundle === target.bundle,
    );
    if (artifact === undefined) {
      problems.push(
        `the update manifest offers ${target.os}/${target.arch}/${target.bundle}, which the release manifest does not describe`,
      );
      continue;
    }
    requireThat(
      artifact.sha256 === target.sha256,
      `the update manifest and the release manifest disagree about ${target.os}/${target.arch}/${target.bundle}: ` +
        `${target.sha256} against ${artifact.sha256}`,
    );
    const component = union.get(`file:${artifact.path}`);
    requireThat(
      component !== undefined,
      `the SBOM does not cover the artifact the updater offers: ${artifact.path}`,
    );
    if (component !== undefined) {
      const declared = sha256Of(component);
      requireThat(
        declared !== undefined && declared === target.sha256,
        `the SBOM and the update manifest disagree about ${artifact.path}: ` +
          `${declared ?? "no digest"} against ${target.sha256}`,
      );
    }
  }

  return updateManifest;
}

/**
 * La attestation: que exista, que firme y que sea de **esta** build.
 *
 * Es la comprobación que hace imposible publicar sin attestation: si
 * el fichero no está, o no verifica, o habla de otra build, la release
 * para.
 */
async function validateAttestations(documents, attestationPaths, publicKeyPath, keyId, builderId, source, commit, stage) {
  if (attestationPaths.length === 0) {
    problems.push("there is no attestation: an unsigned release cannot be published");
    return;
  }

  // El digest de cada SBOM **como fichero**: es lo que la attestation
  // declara como sujeto, y es lo que dice a qué SBOM pertenece.
  const sbomDigests = [];
  for (const entry of documents) {
    let digest;
    try {
      digest = await sha256File(entry.path);
    } catch {
      problems.push(`the SBOM could not be read: ${entry.path}`);
      continue;
    }
    sbomDigests.push({ path: entry.path, digest, document: entry.document });
  }

  const covered = new Set();

  const scratch = await mkdtemp(join(tmpdir(), "tanit-verify-sbom-"));
  try {
    for (const attestationPath of attestationPaths) {
      let raw;
      try {
        raw = await readFile(attestationPath, "utf8");
      } catch {
        problems.push(`the attestation does not exist: ${attestationPath}`);
        continue;
      }

      const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
      if (lines.length === 0) {
        problems.push(`the attestation is empty: ${attestationPath}`);
        continue;
      }
      if (lines.length > 1) {
        problems.push(`the attestation holds ${lines.length} envelopes: it must be one per build`);
      }

      for (const line of lines) {
        let envelope;
        try {
          envelope = JSON.parse(line);
        } catch (error) {
          problems.push(`the attestation could not be parsed: ${error.message}`);
          continue;
        }
        if (!isObject(envelope)) {
          problems.push("the attestation envelope is not an object");
          continue;
        }
        requireThat(
          envelope.payloadType === SBOM_PAYLOAD_TYPE,
          `the attestation payload type must be "${SBOM_PAYLOAD_TYPE}"`,
        );
        const signatures = Array.isArray(envelope.signatures) ? envelope.signatures : [];
        requireThat(signatures.length > 0, "the attestation has no signature");
        for (const signature of signatures) {
          requireThat(
            signature?.keyid === keyId,
            `the attestation is signed by "${signature?.keyid ?? "?"}" and the expected key is "${keyId}"`,
          );
        }

        if (publicKeyPath === undefined) {
          problems.push("there is no public key: the attestation signature cannot be verified");
        } else {
          const payload = Buffer.from(typeof envelope.payload === "string" ? envelope.payload : "", "base64");
          for (const signature of signatures) {
            const bytes = Buffer.from(typeof signature?.sig === "string" ? signature.sig : "", "base64");
            let verified = false;
            try {
              verified = verifySignature(
                publicKeyPath,
                dssePae(envelope.payloadType ?? SBOM_PAYLOAD_TYPE, payload),
                bytes,
                scratch,
              );
            } catch (error) {
              problems.push(`the attestation signature could not be checked: ${error.message}`);
              continue;
            }
            requireThat(verified, "the attestation signature does not verify against the public key");
          }
        }

        let statement;
        try {
          statement = JSON.parse(Buffer.from(String(envelope.payload ?? ""), "base64").toString("utf8"));
        } catch (error) {
          problems.push(`the attestation payload could not be parsed: ${error.message}`);
          continue;
        }
        requireThat(
          statement?._type === SBOM_STATEMENT_TYPE,
          `the statement type must be "${SBOM_STATEMENT_TYPE}"`,
        );
        requireThat(
          statement?.predicateType === SBOM_PROVENANCE_PREDICATE_TYPE,
          `the predicate type must be "${SBOM_PROVENANCE_PREDICATE_TYPE}"`,
        );

        const subjects = Array.isArray(statement?.subject) ? statement.subject : [];
        const subjectDigests = new Set(
          subjects.flatMap((subject) => Object.values(subject?.digest ?? {})),
        );

        // ¿De qué SBOM es esta attestation? Del que declara como sujeto.
        const own = sbomDigests.filter((entry) => subjectDigests.has(entry.digest));
        requireThat(
          own.length > 0,
          "the attestation does not describe any of the SBOMs: it is the attestation of another build",
        );
        for (const entry of own) {
          covered.add(entry.path);
          // Y los artefactos de ese SBOM tienen que estar en la misma
          // attestation: si no, la attestation firma el SBOM pero no lo
          // que el SBOM describe.
          if (stage === undefined) continue;
          for (const ref of fileRefsOf(entry.document)) {
            const path = ref.slice("file:".length);
            const digest = await sha256File(join(stage, path)).catch(() => undefined);
            if (digest === undefined) continue;
            requireThat(
              subjectDigests.has(digest),
              `the attestation does not describe the artifact ${path}`,
            );
          }
        }

        if (builderId !== undefined) {
          requireThat(
            statement?.predicate?.runDetails?.builder?.id === builderId,
            `the provenance says it was built by "${statement?.predicate?.runDetails?.builder?.id ?? "?"}" ` +
              `and the expected builder is "${builderId}"`,
          );
        }
        if (source !== undefined) {
          const declared = statement?.predicate?.buildDefinition?.externalParameters?.source;
          requireThat(
            declared === source,
            `the provenance says it comes from "${declared ?? "?"}" and the expected source is "${source}"`,
          );
        }
        if (commit !== undefined) {
          const digest = statement?.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.sha1;
          requireThat(
            digest === commit,
            `the provenance says it was built from "${digest ?? "?"}" and the expected commit is "${commit}"`,
          );
        }
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  for (const entry of sbomDigests) {
    requireThat(covered.has(entry.path), `the SBOM ${entry.path} has no attestation`);
  }
}

/** El punto de entrada. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (args.sbom.length === 0) {
    usage();
    throw new ReleaseError("`--sbom` is required");
  }

  const stage = args.stage === undefined ? undefined : resolve(REPO_ROOT, args.stage);
  const manifestPath = args.manifest === undefined ? undefined : resolve(REPO_ROOT, args.manifest);
  const updateManifestPath =
    args.updateManifest === undefined ? undefined : resolve(REPO_ROOT, args.updateManifest);
  const publicKeyPath = args.publicKey === undefined ? undefined : resolve(REPO_ROOT, args.publicKey);
  const attestationPaths = args.attestation.map((path) => resolve(REPO_ROOT, path));

  if (args.requireUpdateManifest && updateManifestPath === undefined) {
    problems.push("there is no update manifest: the SBOM cannot be validated against the updater");
  }

  const documents = [];
  for (const sbomPath of args.sbom.map((path) => resolve(REPO_ROOT, path))) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(sbomPath, "utf8"));
    } catch (error) {
      problems.push(`the SBOM could not be read: ${error.message}`);
      continue;
    }
    if (!validateSchema(parsed)) continue;
    validateRequiredComponents(parsed);
    await validateDependencyCoverage(parsed);
    await validateHashes(parsed, stage);
    documents.push({ path: sbomPath, document: parsed });
  }

  if (documents.length === 0 && problems.length === 0) {
    problems.push("there is no SBOM to verify");
  }

  // La unión de los componentes de todos los SBOM: la release se
  // valida como un conjunto, no documento a documento.
  const union = new Map();
  for (const { document } of documents) {
    for (const component of Array.isArray(document.components) ? document.components : []) {
      const ref = component?.["bom-ref"];
      if (typeof ref === "string") union.set(ref, component);
    }
  }

  const releaseManifest = await validateAgainstManifest(documents, union, manifestPath, stage);
  await validateAgainstUpdateManifest(union, updateManifestPath, releaseManifest);
  await validateAttestations(
    documents,
    attestationPaths,
    publicKeyPath,
    args.keyId,
    args.builderId,
    args.source,
    args.commit,
    stage,
  );

  if (problems.length > 0) {
    console.error(`✗ The SBOM does not verify: ${problems.length} problem(s).\n`);
    for (const problem of problems) {
      console.error(`  · ${problem}`);
    }
    console.error("\n  The release stops here: an SBOM that does not verify is not published.");
    return 1;
  }

  console.log(
    `✔ The SBOM verifies: ${documents.length} document(s), ${attestationPaths.length} attestation(s).`,
  );
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
