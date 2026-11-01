/**
 * El SBOM CycloneDX, la provenance y la attestation, probados de punta a
 * punta.
 *
 * ## Qué se prueba aquí y qué no
 *
 * Se prueba **el contrato**: que el SBOM describe lo que dice describir,
 * que el verificador recalcula en vez de creerse, que una attestation
 * ausente o de otra build **impide publicar** y que el manifest del
 * updater y el SBOM hablan del mismo hash.
 *
 * No se prueba la firma de Apple ni la de Microsoft, y no porque sea
 * difícil: es que **no se puede** sin una cuenta de verdad, y un test
 * que necesita una cuenta de Apple no se ejecuta nunca. Lo que sí se
 * prueba es la criptografía que sí es local: Ed25519 con `openssl`, una
 * clave que nace y muere con el test, en un directorio temporal.
 *
 * ## Los cuatro fixtures que pide el criterio
 *
 *   · SBOM válido.
 *   · Dependencia faltante.
 *   · Hash alterado.
 *   · Provenance no relacionada.
 *
 * Y uno más, que es el que sostiene la cadena: **sin attestation no se
 * publica**.
 *
 * ## Los fixtures se construyen con los scripts de verdad
 *
 * El staging lo produce `prepare-artifacts.mjs --dry-run`, el SBOM lo
 * produce `build-sbom.mjs` y la attestation la firma el mismo script con
 * una clave efímera. Los fixtures que rompen algo se rompen **a
 * partir** de esa salida: se edita el JSON y se vuelve a verificar. Un
 * fixture escrito a mano probaría un SBOM que el producto nunca genera.
 *
 * ## Cómo se ejecuta esta spec
 *
 * El comando **canónico** es:
 *
 * ```bash
 * bunx vitest run tests/release/sbom.spec.ts
 * ```
 *
 * Con `bun test` la spec también corre —las dos entradas entienden
 * `test.skipIf`—, pero el runner de referencia del repo es vitest: es
 * el que sabe qué sección es cada fichero y el que ejecuta la CI. Los
 * dos tienen que dar verde, y el que da verde el primero es el que
 * cuenta.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { atob, btoa, Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import {
  SBOM_ATTESTATION_PUBLIC_KEY_PATH,
  SBOM_BUILD_TOOL_PROPERTY,
  SBOM_DEFAULT_KEY_ID,
  SBOM_FORMAT,
  SBOM_PAYLOAD_TYPE,
  SBOM_PROVENANCE_PREDICATE_TYPE,
  SBOM_REQUIRED_COMPONENTS,
  SBOM_RUNS_URL,
  SBOM_SPEC_VERSION,
} from "../../packages/contracts/constants/release/sbom.constant.js";
import { UPDATE_PUBLIC_KEY_PATH } from "../../packages/contracts/constants/release/updater.constant.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";

/** El script que mide el staging y escribe el manifest. */
const PREPARE = join(REPO_ROOT, "scripts", "release", "prepare-artifacts.mjs");
/** El script que construye el SBOM, la provenance y la attestation. */
const BUILD_SBOM = join(REPO_ROOT, "scripts", "release", "build-sbom.mjs");
/** El script que verifica el SBOM. */
const VERIFY_SBOM = join(REPO_ROOT, "scripts", "release", "verify-sbom.mjs");
/** El script que decide qué se adjunta a la release. */
const PUBLISH_GATE = join(REPO_ROOT, "scripts", "release", "publish-gate.mjs");
/** El script que construye el manifest firmado del updater. */
const BUILD_UPDATE = join(REPO_ROOT, "scripts", "release", "build-update-manifest.mjs");

/**
 * La versión que dice la configuración de Tauri.
 *
 * Viene de la constante y no de un literal: el nombre del SBOM, el de
 * la provenance y el de la attestation llevan la versión dentro, y
 * escribirla a mano aquí es garantizar que este test se rompa en
 * cuanto el producto suba de número —que es justo lo que pasó al
 * pasar a `0.1.0-alpha.1`.
 */
const VERSION = CLI_VERSION;
/** El identificador de la clave de attestation, el que dice el contrato. */
const KEY_ID = SBOM_DEFAULT_KEY_ID;
/** El commit del fixture: no es un commit de verdad, es una etiqueta. */
const COMMIT = "fixture0000000000000000000000000000000000";
/** Otro commit, para el fixture de la provenance que no es de esta build. */
const OTHER_COMMIT = "9999999999999999999999999999999999999999";
/** Un tercero, para el caso de que la attestation sea la buena pero diga otro commit. */
const THIRD_COMMIT = "1111111111111111111111111111111111111111";

/** El resultado de un comando. */
interface IResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout + stderr, que es lo que lee quien mira el log. */
  readonly output: string;
}

/**
 * Corre un comando y devuelve su salida.
 *
 * El `env` es para los comandos que necesitan un entorno **distinto**:
 * sin `openssl` en el `PATH`, por ejemplo, para comprobar qué hace el
 * verificador cuando la firma no se puede ni comprobar.
 */
function run(
  command: string,
  args: readonly string[],
  env?: Record<string, string | undefined>,
): IResult {
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...(env === undefined ? {} : { env }),
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

/** Un directorio temporal que se borra al terminar. */
async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** ¿Hay `openssl` en esta máquina? */
const HAS_OPENSSL = spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;

/**
 * La ruta absoluta de bun.
 *
 * Hace falta cuando el `PATH` se cambia: sin `openssl` en el `PATH`,
 * el comando tiene que ser el binario, no su nombre.
 */
const BUN = (() => {
  const probe = spawnSync("bun", ["-e", "process.stdout.write(process.execPath)"], {
    encoding: "utf8",
  });
  return probe.status === 0 ? (probe.stdout ?? "").trim() : "bun";
})();

/** Un componente del SBOM, tal y como lo devuelve el script. */
interface ISbomComponentJson {
  type: string;
  name: string;
  version: string;
  "bom-ref": string;
  purl?: string;
  hashes?: { alg: string; content: string }[];
  properties?: { name: string; value: string }[];
}

/** El documento completo. */
interface ISbomJson {
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    component: ISbomComponentJson;
    lifecycles?: { phase: string }[];
    supplier?: { name?: string; url?: string[] };
  };
  components: ISbomComponentJson[];
  dependencies: { ref: string; dependsOn: string[] }[];
}

/** Un asset del manifest de la release. */
interface IAssetJson {
  kind: string;
  path: string;
  sha256: string;
}

/** El manifest de la release. */
interface IManifestJson {
  schema: string;
  version: string;
  artifacts: {
    path: string;
    sha256: string;
    version: string;
    os?: string;
    arch?: string;
    bundle?: string;
  }[];
  assets: IAssetJson[];
}

/** El manifest del updater. */
interface IUpdateManifestJson {
  version: string;
  targets: { os: string; arch: string; bundle: string; sha256: string }[];
}

/** Lo que hay en una plataforma: el manifest, el SBOM y la attestation. */
interface IPlatformRelease {
  readonly manifest: string;
  readonly sbom: string;
  readonly provenance: string;
  readonly attestation: string;
}

/** Las claves de la attestation: efímeras y locales. */
interface IAttestationKeys {
  readonly key: string;
  readonly publicKey: string;
}

/**
 * Genera una clave de Ed25519 para la attestation.
 *
 * No es una cuenta: es una clave que nace y muere con el test, en un
 * directorio temporal. La privada no sale de él y la pública se puede
 * volver a derivar cuando haga falta.
 */
function createAttestationKeys(home: string): IAttestationKeys | null {
  const key = join(home, "attestation-key.pem");
  const publicKey = join(home, "attestation-pub.pem");
  const generated = run("openssl", ["genpkey", "-algorithm", "ed25519", "-out", key]);
  if (generated.status !== 0) return null;
  const derived = run("openssl", ["pkey", "-in", key, "-pubout", "-out", publicKey]);
  if (derived.status !== 0) return null;
  return { key, publicKey };
}

/**
 * El staging del dry-run: los ocho artefactos de la matriz.
 *
 * Es el staging de verdad —lo produce `prepare-artifacts.mjs`—, con los
 * artefactos de Linux firmados con una clave GPG efímera. Los de macOS
 * y Windows quedan sin firmar porque en Linux no hay certificado de
 * Apple ni de Microsoft: su verificador falla cerrado, que es lo que
 * tiene que pasar.
 */
async function dryRunStaging(prefix: string): Promise<string> {
  const stage = await tempDir(prefix);
  const result = run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]);
  expect(result.status, result.output).toBe(0);
  return stage;
}

/**
 * Los tres ficheros de una plataforma: el manifest, el SBOM y la
 * attestation.
 *
 * El orden es el del pipeline: primero se mide el staging, después se
 * construye el SBOM **a partir** de lo medido, y después se vuelve a
 * medir para que el manifest describa también el SBOM y la
 * attestation. El manifest que se devuelve es el segundo.
 */
async function platformRelease(
  stage: string,
  os: string,
  arch: string,
  keys: IAttestationKeys,
  options: { readonly commit?: string; readonly runId?: string } = {},
): Promise<IPlatformRelease> {
  const platformDir = join(stage, os, arch);
  const manifest = join(platformDir, "release-manifest.json");
  const base = join(platformDir, "sbom", `Tanit_${VERSION}-${os}-${arch}`);
  const provenance = join(platformDir, "provenance", `Tanit_${VERSION}-${os}-${arch}.provenance.json`);
  const attestation = join(platformDir, "attestation", `Tanit_${VERSION}-${os}-${arch}.intoto.jsonl`);
  const commit = options.commit ?? COMMIT;

  const measured = run("bun", [
    "run",
    PREPARE,
    "--stage",
    stage,
    "--os",
    os,
    "--arch",
    arch,
    "--manifest",
    manifest,
  ]);
  expect(measured.status, measured.output).toBe(0);

  const built = run("bun", [
    "run",
    BUILD_SBOM,
    "--stage",
    stage,
    "--manifest",
    manifest,
    "--key",
    keys.key,
    "--key-id",
    KEY_ID,
    "--source",
    "release-desktop",
    "--commit",
    commit,
    ...(options.runId === undefined ? [] : ["--run-id", options.runId]),
  ]);
  expect(built.status, built.output).toBe(0);

  // El manifest se vuelve a medir: ahora tiene que describir también
  // el SBOM, la provenance y la attestation.
  const remeasured = run("bun", [
    "run",
    PREPARE,
    "--stage",
    stage,
    "--os",
    os,
    "--arch",
    arch,
    "--manifest",
    manifest,
  ]);
  expect(remeasured.status, remeasured.output).toBe(0);

  return {
    manifest,
    sbom: `${base}.cdx.json`,
    provenance,
    attestation,
  };
}

/** Escribe un SBOM editado, en un sitio que no pisa el original. */
async function writeSbom(path: string, document: unknown): Promise<string> {
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

/**
 * El documento del SBOM con los huecos donde puede haber cualquier cosa.
 *
 * Las tres formas que el verificador tiene que rechazar —un proveedor
 * que no es un objeto, un componente que no es un objeto, una entrada
 * del grafo que no es un objeto— no se pueden escribir con los tipos
 * del SBOM bueno: el documento que llega al verificador es JSON, y el
 * JSON puede no ser un objeto donde se espera uno.
 */
interface IRawSbomJson {
  metadata: Record<string, unknown>;
  components: unknown[];
  dependencies: unknown[];
}

/** Lee un SBOM. */
async function readSbom(path: string): Promise<ISbomJson> {
  return JSON.parse(await readFile(path, "utf8")) as ISbomJson;
}

/** Lee el manifest de la release. */
async function readManifest(path: string): Promise<IManifestJson> {
  return JSON.parse(await readFile(path, "utf8")) as IManifestJson;
}

// --- el andamiaje de las mutaciones ----------------------------------------
//
// ## Qué es esto
//
// Un control de seguridad vale lo que vale su prueba. Si el verificador
// deja de comprobar la firma y la suite sigue verde, el control no
// existe: lo único que dice es que nadie lo ha mirado.
//
// Estas piezas sirven para **romper el fixture por un solo camino**:
// editar el SBOM, volver a firmar la attestation con la clave del
// test, y dejar que el verificador diga **lo que la mutación provoca**
// y nada más.
//
// ## Por qué hay que volver a firmar
//
// Un SBOM editado cambia su digest, y entonces la attestation deja de
// describirlo: el único fallo sería «la attestation es de otra build»
// y el control que se quiere probar no se vería nunca. Por eso las
// mutaciones **vuelven a firmar** la attestation con la clave del
// fixture —que nace y muere con el test, en un directorio temporal—
// para que el enlace siga en pie y el problema sea el de la mutación.
//
// ## El PAE
//
// El PAE de DSSE es lo que se firma de verdad, y el constructor lo
// construye así. La prueba lo reconstruye igual: si el PAE no fuera el
// mismo, la firma no verificaría y la prueba del control de la firma
// probaría otra cosa.

/** Un envelope DSSE, tal y como lo escribe el constructor. */
interface IEnvelopeJson {
  payloadType: string;
  payload: string;
  signatures: { keyid: string; sig: string }[];
}

/** El statement in-toto que va dentro del envelope. */
interface IStatementJson {
  _type: string;
  predicateType: string;
  subject: { name: string; digest: Record<string, string> }[];
  predicate: {
    buildDefinition: {
      externalParameters: {
        source: { uri: string; digest?: { sha1: string } };
        release?: string;
      };
      resolvedDependencies: { name: string; digest: { sha1: string } }[];
    };
    runDetails: { builder: { id: string } };
  };
}

// --- los bytes ------------------------------------------------------------
//
// La prueba construye el PAE de DSSE, lo firma y lo vuelve a firmar:
// hace falta trabajar con bytes. Los tipos que ve la prueba no
// declaran los estáticos de `Buffer` —los declara el entorno, no node—
// ni aceptan un `Uint8Array` donde el `node:fs` quiere bytes, así que
// la prueba habla el idioma que sí está tipado: texto latin1 de un
// lado, base64 del otro, y `Uint8Array` para lo demás. El runtime es
// el de node: los bytes que se escriben son los mismos.

/** Los bytes, como texto latin1: un carácter por byte. */
function toLatin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** El texto latin1, como bytes: un byte por carácter. */
function fromLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index);
  }
  return bytes;
}

/** Los bytes, en base64. */
function toBase64(bytes: Uint8Array): string {
  return btoa(toLatin1(bytes));
}

/** El base64, en bytes. */
function fromBase64(text: string): Uint8Array {
  return fromLatin1(atob(text));
}

/** El texto, en UTF-8. */
function encodeUtf8(text: string): Uint8Array {
  return Buffer.from(text, "utf8");
}

/** El UTF-8, en texto. */
function decodeUtf8(text: string): string {
  return decodeURIComponent(
    Array.from(text, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
  );
}

/** Los bytes, uno detrás de otro. */
function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/** El PAE de DSSE: lo que se firma de verdad. */
function dssePae(payloadType: string, payload: Uint8Array): Uint8Array {
  const type = encodeUtf8(payloadType);
  return concatBytes([
    encodeUtf8(`DSSEv1 ${type.length} ${payloadType} `),
    encodeUtf8(`${payload.length} `),
    payload,
  ]);
}

/** Firma unos bytes con la clave de la attestation. */
function signBytes(keyPath: string, bytes: Uint8Array, scratch: string): string {
  const input = join(scratch, "pae.bin");
  const signature = join(scratch, "signature.bin");
  writeFileSync(input, toLatin1(bytes), "latin1");
  const result = run("openssl", [
    "pkeyutl",
    "-sign",
    "-rawin",
    "-inkey",
    keyPath,
    "-in",
    input,
    "-out",
    signature,
  ]);
  expect(result.status, result.output).toBe(0);
  return toBase64(fromLatin1(readFileSync(signature, "latin1")));
}

/** El SHA-256 de un fichero, en hexadecimal minúsculas. */
async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", (error) => reject(error));
  });
  return hash.digest("hex");
}

/** Lee el envelope de una attestation. */
async function readEnvelope(path: string): Promise<IEnvelopeJson> {
  const raw = await readFile(path, "utf8");
  const line = raw
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  expect(line, "the attestation is empty").toBeDefined();
  return JSON.parse(line ?? "") as IEnvelopeJson;
}

/** Escribe un envelope como una attestation. */
async function writeEnvelope(path: string, envelope: IEnvelopeJson): Promise<string> {
  await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");
  return path;
}

/** El statement que va dentro del envelope. */
function statementOf(envelope: IEnvelopeJson): IStatementJson {
  return JSON.parse(decodeUtf8(atob(envelope.payload))) as IStatementJson;
}

/** Vuelve a firmar un envelope con el payload que ya tiene. */
function reseal(envelope: IEnvelopeJson, keyPath: string, scratch: string): IEnvelopeJson {
  const payload = fromBase64(envelope.payload);
  const sig = signBytes(keyPath, dssePae(envelope.payloadType, payload), scratch);
  return { ...envelope, signatures: envelope.signatures.map((entry) => ({ ...entry, sig })) };
}

/** Muta el statement de un envelope y vuelve a firmarlo. */
function resealStatement(
  envelope: IEnvelopeJson,
  mutate: (statement: IStatementJson) => void,
  keyPath: string,
  scratch: string,
): IEnvelopeJson {
  const statement = statementOf(envelope);
  mutate(statement);
  const payload = encodeUtf8(JSON.stringify(statement));
  const sig = signBytes(keyPath, dssePae(envelope.payloadType, payload), scratch);
  return {
    ...envelope,
    payload: toBase64(payload),
    signatures: envelope.signatures.map((entry) => ({ ...entry, sig })),
  };
}

/** Una firma Ed25519 que tiene la forma correcta y no verifica. */
function corruptedSignature(): string {
  // Sesenta y cuatro bytes —lo que mide una firma de Ed25519— que no
  // son los de la firma de verdad: el base64 es válido, la firma no.
  return toBase64(new Uint8Array(64).fill(7));
}

/**
 * Una raíz de repo falsa: las mismas fuentes, en otro sitio.
 *
 * El ayudante de raíz busca `package.json` y `delendai.config.json`
 * subiendo desde el propio script, así que una copia de las fuentes en
 * un directorio con esos dos marcadores **es** un repo: el `REPO_ROOT`
 * de los scripts copiados es la copia, y lo que no está en la copia no
 * se puede leer.
 *
 * Es lo que permite provocar los controles que dependen de que el
 * repo esté roto —un `Cargo.toml` ilegible, un `bun.lock` sin las
 * dependencias de runtime, una clave pública que no está versionada—
 * sin tocar el repo de verdad.
 */
async function fakeRepo(
  scratch: string,
  name: string,
  scripts: readonly string[],
): Promise<string> {
  const root = join(scratch, name);
  await mkdir(join(root, "scripts", "helpers"), { recursive: true });
  await mkdir(join(root, "scripts", "release"), { recursive: true });
  await mkdir(join(root, "packages", "contracts", "constants", "release"), { recursive: true });
  await mkdir(join(root, "packages", "contracts", "constants", "cli"), { recursive: true });
  // Los dos marcadores que el ayudante de raíz busca.
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  await writeFile(join(root, "delendai.config.json"), "{}\n", "utf8");
  for (const helper of ["root.helper.ts", "glob.helper.ts", "release-dependencies.helper.ts"]) {
    await copyFile(
      join(REPO_ROOT, "scripts", "helpers", helper),
      join(root, "scripts", "helpers", helper),
    );
  }
  for (const script of scripts) {
    await copyFile(
      join(REPO_ROOT, "scripts", "release", script),
      join(root, "scripts", "release", script),
    );
  }
  await copyFile(
    join(REPO_ROOT, "packages", "contracts", "constants", "release", "signing.constant.ts"),
    join(root, "packages", "contracts", "constants", "release", "signing.constant.ts"),
  );
  await copyFile(
    join(REPO_ROOT, "packages", "contracts", "constants", "release", "sbom.constant.ts"),
    join(root, "packages", "contracts", "constants", "release", "sbom.constant.ts"),
  );
  await copyFile(
    join(REPO_ROOT, "packages", "contracts", "constants", "cli", "cli-version.constant.ts"),
    join(root, "packages", "contracts", "constants", "cli", "cli-version.constant.ts"),
  );
  return root;
}

/**
 * Una raíz de repo falsa, sin la clave pública versionada.
 *
 * El gate adjunta la clave pública **por su ruta en el repositorio**,
 * así que la única forma de que falte es que el fichero no esté. La
 * raíz falsa reproduce esa situación sin tocar el repo: son las mismas
 * fuentes, en otro sitio, con los mismos marcadores de raíz.
 */
async function fakeRootWithoutPublicKey(scratch: string): Promise<string> {
  return fakeRepo(scratch, "fake-root", ["publish-gate.mjs"]);
}

describe("el SBOM CycloneDX y la attestation de provenance", () => {
  let scratch = "";
  let stage = "";
  let keys: IAttestationKeys | null = null;
  let platform: IPlatformRelease | null = null;

  beforeAll(async () => {
    scratch = await tempDir("tanit-sbom");
    stage = await dryRunStaging("tanit-sbom-stage");
    const attestationKeys = createAttestationKeys(scratch);
    keys = attestationKeys;
    if (attestationKeys === null) return;
    platform = await platformRelease(stage, "linux", "x64", attestationKeys);
  });

  afterAll(async () => {
    if (scratch !== "") await rm(scratch, { recursive: true, force: true });
    if (stage !== "") await rm(stage, { recursive: true, force: true });
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM válido verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--provenance",
      platform.provenance,
      "--require-provenance",
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
      "--source",
      "release-desktop",
      "--commit",
      COMMIT,
    ]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("The SBOM verifies");
  });

  test.skipIf(!HAS_OPENSSL)("el SBOM describe el producto y su grafo de dependencias", async () => {
    if (platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    expect(document.bomFormat).toBe(SBOM_FORMAT);
    expect(document.specVersion).toBe(SBOM_SPEC_VERSION);
    expect(document.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);

    const names = document.components.map((component) => component.name);
    // El producto: la ventana y el sidecar.
    for (const required of SBOM_REQUIRED_COMPONENTS) {
      expect(names).toContain(required);
    }
    // El grafo: las crates que entran en el binario y los paquetes que
    // entran en el sidecar.
    expect(names).toContain("tauri");
    expect(names).toContain("zod");

    // Y el grafo dice de quién cuelgan.
    const desktop = document.components.find(
      (component) => component.name === SBOM_REQUIRED_COMPONENTS[0],
    );
    const sidecar = document.components.find(
      (component) => component.name === SBOM_REQUIRED_COMPONENTS[1],
    );
    const zod = document.components.find((component) => component.name === "zod");
    const desktopEdges = document.dependencies.find((entry) => entry.ref === desktop?.["bom-ref"]);
    const sidecarEdges = document.dependencies.find((entry) => entry.ref === sidecar?.["bom-ref"]);
    expect(
      desktopEdges?.dependsOn.some((ref) => ref.startsWith("pkg:cargo/tauri@")) ?? false,
    ).toBe(true);
    expect(sidecarEdges?.dependsOn).toContain(zod?.["bom-ref"]);
  });

  test.skipIf(!HAS_OPENSSL)("el SBOM describe lo que va empaquetado, no lo que se construyó", async () => {
    if (platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    const names = document.components.map((component) => component.name);
    // `tauri-build` la usa el `build.rs`: no viaja dentro del binario,
    // y declararla sería decir que el producto lleva un compilador.
    expect(names).not.toContain("tauri-build");

    // Y una herramienta de build se declara **como lo que es**: con la
    // propiedad que dice que no va empaquetada, y sin colgar del
    // producto en el grafo.
    const tool = document.components.find((component) => component.name === "patchelf");
    expect(tool, "the build tool is not declared").toBeDefined();
    const property = tool?.properties?.find(
      (candidate) => candidate.name === SBOM_BUILD_TOOL_PROPERTY,
    );
    expect(property?.value).toBe("not packaged");

    const desktop = document.components.find(
      (component) => component.name === SBOM_REQUIRED_COMPONENTS[0],
    );
    const desktopEdges = document.dependencies.find((entry) => entry.ref === desktop?.["bom-ref"]);
    expect(desktopEdges?.dependsOn).not.toContain(tool?.["bom-ref"]);
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM sin dependencia verificable no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    // Se cae una dependencia que el sidecar **usa**: el SBOM ya no
    // describe lo que va dentro del binario.
    const removed = document.components.find((component) => component.name === "zod");
    document.components = document.components.filter((component) => component.name !== "zod");
    document.dependencies = document.dependencies.map((entry) => ({
      ...entry,
      dependsOn: entry.dependsOn.filter((ref) => ref !== removed?.["bom-ref"]),
    }));
    const broken = await writeSbom(join(scratch, "missing-dependency.cdx.json"), document);

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      broken,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("zod");
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM con el hash alterado no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    const artifact = document.components.find((component) => component["bom-ref"].startsWith("file:"));
    expect(artifact).toBeDefined();
    const hashes = artifact?.hashes ?? [];
    expect(hashes.length).toBeGreaterThan(0);
    const first = hashes[0];
    if (first === undefined) throw new Error("the artifact has no hash");
    first.content = "0".repeat(64);
    const broken = await writeSbom(join(scratch, "tampered.cdx.json"), document);

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      broken,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("does not match the staging");
  });

  test.skipIf(!HAS_OPENSSL)("una provenance que no es de esta build no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    // Una attestation **bien firmada** de otra build: la firma verifica,
    // pero no describe este SBOM. Es el caso peligroso: una attestation
    // que parece buena y no dice nada de lo que se está publicando.
    const otherStage = await dryRunStaging("tanit-sbom-other-stage");
    const other = await platformRelease(otherStage, "linux", "x64", keys, {
      commit: OTHER_COMMIT,
    });
    try {
      const result = run("bun", [
        "run",
        VERIFY_SBOM,
        "--sbom",
        platform.sbom,
        "--attestation",
        other.attestation,
        "--stage",
        stage,
        "--manifest",
        platform.manifest,
        "--public-key",
        keys.publicKey,
        "--key-id",
        KEY_ID,
      ]);
      expect(result.status).toBe(1);
      expect(result.output).toContain("attestation of another build");
    } finally {
      await rm(otherStage, { recursive: true, force: true });
    }

    // Y la otra forma de que la provenance no sea de esta build: la
    // attestation es la buena, pero dice otro commit.
    const mismatched = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
      "--commit",
      THIRD_COMMIT,
    ]);
    expect(mismatched.status).toBe(1);
    expect(mismatched.output).toContain("the expected commit is");
  });

  test.skipIf(!HAS_OPENSSL)("sin attestation no se publica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("there is no attestation");

    // Y el gate de publicación tampoco: un manifest que no describe la
    // attestation es una release que no se puede auditar, y una release
    // que no se puede auditar no se publica.
    const manifest = await readManifest(platform.manifest);
    manifest.assets = manifest.assets.filter((asset) => asset.kind !== "attestation");
    const withoutAttestation = join(scratch, "without-attestation.json");
    await writeFile(withoutAttestation, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const gate = run("bun", [
      "run",
      PUBLISH_GATE,
      "--stage",
      stage,
      "--manifest",
      withoutAttestation,
      "--allow-unsigned",
    ]);
    expect(gate.status).toBe(1);
    // El mensaje **exacto**, no la palabra: con un aserto laxo el
    // control podría desaparecer sin que nada se rompiera, porque
    // otras rutas del gate también hablan de la attestation.
    expect(gate.output).toContain('the release does not attach a "attestation" asset');
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM sin la cobertura de una dependencia no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    const removed = document.components.find((component) => component.name === "tauri");
    expect(removed, "the fixture has no tauri crate").toBeDefined();
    const ref = removed?.["bom-ref"];
    // Se cae el componente **y** su entrada en `dependencies[]`, y se
    // limpian las aristas que lo nombraban: el documento queda
    // estructuralmente coherente, así que lo que tiene que fallar es la
    // **cobertura**, no el schema.
    document.components = document.components.filter(
      (component) => component["bom-ref"] !== ref,
    );
    document.dependencies = document.dependencies
      .filter((entry) => entry.ref !== ref)
      .map((entry) => ({
        ...entry,
        dependsOn: entry.dependsOn.filter((target) => target !== ref),
      }));
    const broken = await writeSbom(join(scratch, "missing-coverage.cdx.json"), document);

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      broken,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not describe the dependency "tauri" of the desktop');
    // Y el fallo **no** es de schema: el grafo sigue siendo coherente.
    expect(result.output).not.toContain("points at the unknown component");
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM sin el componente requerido no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    const required = SBOM_REQUIRED_COMPONENTS[0];
    const removed = document.components.find((component) => component.name === required);
    expect(removed, `the fixture has no ${required}`).toBeDefined();
    const ref = removed?.["bom-ref"];
    document.components = document.components.filter(
      (component) => component["bom-ref"] !== ref,
    );
    document.dependencies = document.dependencies
      .filter((entry) => entry.ref !== ref)
      .map((entry) => ({
        ...entry,
        dependsOn: entry.dependsOn.filter((target) => target !== ref),
      }));
    const broken = await writeSbom(join(scratch, "missing-required.cdx.json"), document);

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      broken,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`does not describe the required component "${required}"`);
  });

  test.skipIf(!HAS_OPENSSL)("un digest malformado no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const document = await readSbom(platform.sbom);
    const crate = document.components.find((component) => component.name === "tauri");
    const hash = crate?.hashes?.[0];
    expect(hash?.alg).toBe("SHA-256");
    if (hash === undefined) throw new Error("the crate has no digest");
    // Diez hexadecimales no son un SHA-256: el documento declara un
    // digest que no puede ser el de nada.
    hash.content = "0".repeat(10);
    const broken = await writeSbom(join(scratch, "malformed-digest.cdx.json"), document);

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      broken,
      "--attestation",
      platform.attestation,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("malformed SHA-256 digest");
  });

  test.skipIf(!HAS_OPENSSL)("una provenance publicada que no es la firmada no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const statement = JSON.parse(await readFile(platform.provenance, "utf8")) as {
      predicate: { runDetails: { builder: { id: string } } };
      subject: { name: string; digest: { sha256: string } }[];
    };

    // El builder cambia: el statement en claro dice que lo construyó
    // otro, y la firma sigue diciendo lo que dijo.
    const builder = statement.predicate.runDetails.builder.id;
    statement.predicate.runDetails.builder.id = "https://example.invalid/other-builder";
    const otherBuilder = join(scratch, "other-builder.provenance.json");
    await writeFile(otherBuilder, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

    const builderResult = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--provenance",
      otherBuilder,
      "--require-provenance",
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(builderResult.status).toBe(1);
    expect(builderResult.output).toContain("and the attestation says");
    expect(builderResult.output).toContain(builder);

    // Y un digest de un sujeto: la provenance ya no describe lo que se
    // firmó, así que no corresponde a ninguna attestation.
    statement.predicate.runDetails.builder.id = builder;
    const subject = statement.subject[0];
    expect(subject).toBeDefined();
    if (subject === undefined) throw new Error("the statement has no subject");
    subject.digest.sha256 = "0".repeat(64);
    const otherDigest = join(scratch, "other-digest.provenance.json");
    await writeFile(otherDigest, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

    const digestResult = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--provenance",
      otherDigest,
      "--require-provenance",
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(digestResult.status).toBe(1);
    expect(digestResult.output).toContain("does not correspond to any attestation of this release");
  });

  test.skipIf(!HAS_OPENSSL)("la provenance publicada que dice otro commit no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const statement = JSON.parse(await readFile(platform.provenance, "utf8")) as {
      predicate: {
        buildDefinition: {
          externalParameters: { source: { digest: { sha1: string } } };
          resolvedDependencies: { digest: { sha1: string } }[];
        };
      };
    };
    // Sólo el commit: ni el builder ni los sujetos. El statement en
    // claro dice que la build salió de otro commit, y la firma sigue
    // diciendo el suyo. Publicar los dos es publicar dos versiones de
    // la verdad, y sólo una está firmada.
    statement.predicate.buildDefinition.externalParameters.source.digest.sha1 = OTHER_COMMIT;
    const resolved = statement.predicate.buildDefinition.resolvedDependencies[0];
    expect(resolved, "the provenance has no resolved dependency").toBeDefined();
    if (resolved === undefined) throw new Error("the provenance has no resolved dependency");
    resolved.digest.sha1 = OTHER_COMMIT;
    const otherCommit = join(scratch, "other-commit.provenance.json");
    await writeFile(otherCommit, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--provenance",
      otherCommit,
      "--require-provenance",
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("says it was built from");
    expect(result.output).toContain(OTHER_COMMIT);
    expect(result.output).toContain(COMMIT);
  });

  test.skipIf(!HAS_OPENSSL)("la provenance publicada con otro predicateType no verifica", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    const statement = JSON.parse(await readFile(platform.provenance, "utf8")) as {
      predicateType: string;
    };
    // Sólo el `predicateType`: el statement en claro deja de ser SLSA
    // y la firma sigue diciendo SLSA. Un verificador que no lo
    // comprueba acepta una provenance que ningún auditor puede leer.
    statement.predicateType = "https://example.invalid/provenance/v1";
    const otherType = join(scratch, "other-predicate-type.provenance.json");
    await writeFile(otherType, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

    const result = run("bun", [
      "run",
      VERIFY_SBOM,
      "--sbom",
      platform.sbom,
      "--attestation",
      platform.attestation,
      "--provenance",
      otherType,
      "--require-provenance",
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("predicate type");
    expect(result.output).toContain(SBOM_PROVENANCE_PREDICATE_TYPE);
  });

  test.skipIf(!HAS_OPENSSL)("la provenance dice de qué run vino", async () => {
    if (keys === null) throw new Error("the fixture could not be built");
    const otherStage = await dryRunStaging("tanit-sbom-run-stage");
    try {
      const other = await platformRelease(otherStage, "linux", "x64", keys, { runId: "4242" });
      const statement = JSON.parse(await readFile(other.provenance, "utf8")) as {
        predicate: { runDetails: { metadata: { invocationId?: string } } };
      };
      // El `invocationId` es la URL del run: sin ella, la provenance no
      // dice de dónde salió, y un identificador inventado no dice nada.
      expect(statement.predicate.runDetails.metadata.invocationId).toBe(`${SBOM_RUNS_URL}/4242`);
    } finally {
      await rm(otherStage, { recursive: true, force: true });
    }
  });

  test.skipIf(!HAS_OPENSSL)("sin run no se inventa el invocationId", async () => {
    if (keys === null) throw new Error("the fixture could not be built");
    const otherStage = await dryRunStaging("tanit-sbom-no-run-stage");
    try {
      // Sin `--run-id` no hay run que citar, y un `invocationId`
      // inventado —un UUID que no abre nada— parece un enlace y no lo
      // es: el enlace tiene que existir o no estar.
      const other = await platformRelease(otherStage, "linux", "x64", keys);
      const statement = JSON.parse(await readFile(other.provenance, "utf8")) as {
        predicate: { runDetails: { metadata: Record<string, unknown> } };
      };
      const metadata = statement.predicate.runDetails.metadata;
      expect(metadata).not.toHaveProperty("invocationId");
      expect(metadata.invocationId).toBeUndefined();
      // Lo que sí se dice es cuándo se construyó: eso no se inventa.
      expect(typeof metadata.startedOn).toBe("string");
    } finally {
      await rm(otherStage, { recursive: true, force: true });
    }
  });

  test.skipIf(!HAS_OPENSSL)("el staging no puede llevar secretos", async () => {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    // Una clave privada en el staging es una clave privada publicada:
    // el script tiene que parar antes de medir nada.
    const secret = join(stage, "linux", "x64", "sbom", "server.key");
    await writeFile(secret, "not a real key, a fixture that has to be refused\n", "utf8");
    try {
      const result = run("bun", [
        "run",
        BUILD_SBOM,
        "--stage",
        stage,
        "--manifest",
        platform.manifest,
        "--key",
        keys.key,
      ]);
      expect(result.status).toBe(1);
      expect(result.output).toContain("must never be published");
    } finally {
      await rm(secret, { force: true });
    }
  });
});

describe("la release entera: los cuatro SBOM y el manifest del updater", () => {
  let scratch = "";
  let stage = "";
  let keys: IAttestationKeys | null = null;
  let merged = "";
  let updateManifest = "";
  const sboms: string[] = [];
  const attestations: string[] = [];
  const provenances: string[] = [];

  beforeAll(async () => {
    scratch = await tempDir("tanit-sbom-release");
    stage = await dryRunStaging("tanit-sbom-release-stage");
    const attestationKeys = createAttestationKeys(scratch);
    keys = attestationKeys;
    if (attestationKeys === null) return;

    const matrix: readonly (readonly [string, string])[] = [
      ["macos", "x64"],
      ["macos", "arm64"],
      ["windows", "x64"],
      ["linux", "x64"],
    ];
    for (const [os, arch] of matrix) {
      const platform = await platformRelease(stage, os, arch, attestationKeys);
      sboms.push(platform.sbom);
      attestations.push(platform.attestation);
      provenances.push(platform.provenance);
    }

    merged = join(stage, "release-manifest.json");
    // El dry-run deja un manifest de la release entera en la raíz del
    // staging. En el runner de publicación no está: cada corredor
    // sube el suyo y el merge los junta. Sin borrarlo, el merge
    // encontraría los mismos artefactos dos veces.
    await rm(join(stage, "release-manifest.json"), { force: true });
    const merge = run("bun", ["run", PREPARE, "--merge", stage, "--manifest", merged]);
    expect(merge.status, merge.output).toBe(0);

    const updaterDir = join(scratch, "updater");
    await mkdir(updaterDir, { recursive: true });
    updateManifest = join(updaterDir, "latest.json");
    const update = run("bun", [
      "run",
      BUILD_UPDATE,
      "--stage",
      stage,
      "--manifest",
      merged,
      "--out",
      updaterDir,
      "--key",
      attestationKeys.key,
      "--version",
      VERSION,
      "--commit",
      COMMIT,
    ]);
    expect(update.status, update.output).toBe(0);
  });

  afterAll(async () => {
    if (scratch !== "") await rm(scratch, { recursive: true, force: true });
    if (stage !== "") await rm(stage, { recursive: true, force: true });
  });

  test.skipIf(!HAS_OPENSSL)("el manifest del updater y el SBOM se validan mutuamente", async () => {
    if (keys === null) throw new Error("the fixture could not be built");
    const args = ["run", VERIFY_SBOM];
    for (const sbom of sboms) args.push("--sbom", sbom);
    for (const attestation of attestations) args.push("--attestation", attestation);
    for (const provenance of provenances) args.push("--provenance", provenance);
    args.push(
      "--stage",
      stage,
      "--manifest",
      merged,
      "--update-manifest",
      updateManifest,
      "--require-update-manifest",
      "--require-provenance",
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
      "--commit",
      COMMIT,
    );
    const result = run("bun", args);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("The SBOM verifies");
  });

  test.skipIf(!HAS_OPENSSL)("un SBOM sin attestation no verifica", async () => {
    if (keys === null) throw new Error("the fixture could not be built");
    // Los cuatro SBOM de la release y **una** attestation: los otros
    // tres no tienen quién los firmara, y una release sin attestation
    // por SBOM no se puede auditar.
    const args = ["run", VERIFY_SBOM];
    for (const sbom of sboms) args.push("--sbom", sbom);
    const only = attestations[0];
    expect(only).toBeDefined();
    if (only === undefined) throw new Error("there is no attestation");
    args.push("--attestation", only);
    args.push(
      "--stage",
      stage,
      "--manifest",
      merged,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    );
    const result = run("bun", args);
    expect(result.status).toBe(1);
    expect(result.output).toContain("has no attestation");
  });

  test.skipIf(!HAS_OPENSSL)("un hash del updater que no cuadra no verifica", async () => {
    if (keys === null) throw new Error("the fixture could not be built");
    const document = JSON.parse(await readFile(updateManifest, "utf8")) as {
      targets: { sha256: string }[];
    };
    const target = document.targets[0];
    expect(target).toBeDefined();
    if (target === undefined) throw new Error("the update manifest offers nothing");
    target.sha256 = "0".repeat(64);
    const broken = join(scratch, "broken-latest.json");
    await writeFile(broken, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    const args = ["run", VERIFY_SBOM];
    for (const sbom of sboms) args.push("--sbom", sbom);
    for (const attestation of attestations) args.push("--attestation", attestation);
    args.push(
      "--stage",
      stage,
      "--manifest",
      merged,
      "--update-manifest",
      broken,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
    );
    const result = run("bun", args);
    expect(result.status).toBe(1);
    expect(result.output).toContain("disagree about");
  });

  test.skipIf(!HAS_OPENSSL)("el gate adjunta el SBOM, la provenance y la attestation", async () => {
    const gate = run("bun", [
      "run",
      PUBLISH_GATE,
      "--stage",
      stage,
      "--manifest",
      merged,
      "--allow-unsigned",
      "--list",
    ]);
    // Los artefactos de macOS y Windows no se pueden firmar en Linux, así
    // que el gate corre en modo inspección: lo que se comprueba aquí es
    // que la transparencia está adjunta.
    expect(gate.status, gate.output).toBe(0);
    const attached = gate.stdout.split("\n").map((line) => line.trim());
    expect(attached.some((file) => file.endsWith(".cdx.json"))).toBe(true);
    expect(attached.some((file) => file.endsWith(".provenance.json"))).toBe(true);
    expect(attached.some((file) => file.endsWith(".intoto.jsonl"))).toBe(true);
    // Y la clave pública de la attestation: sin ella, la attestation
    // adjunta no la puede verificar un tercero.
    expect(attached.some((file) => file.endsWith(".pub.pem"))).toBe(true);
    // Y es **la versionada del repositorio**, por su ruta: la lista que
    // imprime el gate es la que sube la acción de la release, así que
    // la clave que se adjunta tiene que ser la del repo y sólo esa.
    expect(attached).toContain(join(REPO_ROOT, SBOM_ATTESTATION_PUBLIC_KEY_PATH));
    expect(attached.filter((file) => file.endsWith(".pub.pem"))).toHaveLength(1);
  });

  test.skipIf(!HAS_OPENSSL)("el gate adjunta la clave versionada aunque el staging traiga una copia", async () => {
    // El staging **puede** llevar una copia de la clave pública —el
    // constructor del SBOM la permite—. Si el gate la publicara, la
    // release llevaría dos ficheros con el mismo nombre y el último que
    // sube pisaría al otro; y la copia no la describe el manifest, así
    // que sería un asset que nadie ha auditado. La clave que se
    // adjunta es la versionada, y sólo la versionada.
    const copyDir = join(stage, "linux", "x64", "keys");
    const copy = join(copyDir, basename(SBOM_ATTESTATION_PUBLIC_KEY_PATH));
    await mkdir(copyDir, { recursive: true });
    await copyFile(join(REPO_ROOT, SBOM_ATTESTATION_PUBLIC_KEY_PATH), copy);
    try {
      const gate = run("bun", [
        "run",
        PUBLISH_GATE,
        "--stage",
        stage,
        "--manifest",
        merged,
        "--allow-unsigned",
        "--list",
      ]);
      expect(gate.status, gate.output).toBe(0);
      const attached = gate.stdout.split("\n").map((line) => line.trim());
      expect(attached.filter((file) => file.endsWith(".pub.pem"))).toHaveLength(1);
      expect(attached).toContain(join(REPO_ROOT, SBOM_ATTESTATION_PUBLIC_KEY_PATH));
    } finally {
      await rm(copyDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!HAS_OPENSSL)("sin los assets de transparencia el gate cierra la release", async () => {
    // Se quita el SBOM del staging: el manifest sigue describiéndolo, y
    // el gate tiene que decir que el fichero no está.
    const sbom = sboms[0];
    expect(sbom).toBeDefined();
    if (sbom === undefined) throw new Error("there is no SBOM");
    const hidden = `${sbom}.hidden`;
    await copyFile(sbom, hidden);
    await rm(sbom);
    try {
      const gate = run("bun", [
        "run",
        PUBLISH_GATE,
        "--stage",
        stage,
        "--manifest",
        merged,
        "--allow-unsigned",
      ]);
      expect(gate.status).toBe(1);
      expect(gate.output).toContain("not in the staging");
    } finally {
      await copyFile(hidden, sbom);
      await rm(hidden, { force: true });
    }
  });

  // --- la cobertura de la provenance por attestation ------------------------
  //
  // Cuatro SBOM, cuatro attestations y **una** provenance: tres
  // attestations que nadie puede leer en claro. La release publicaría
  // tres verdades que no se pueden contrastar con la firmada.

  test.skipIf(!HAS_OPENSSL)("una attestation sin provenance no verifica", () => {
    if (keys === null) throw new Error("the fixture could not be built");
    const args = ["run", VERIFY_SBOM];
    for (const sbom of sboms) args.push("--sbom", sbom);
    for (const attestation of attestations) args.push("--attestation", attestation);
    const only = provenances[0];
    expect(only).toBeDefined();
    if (only === undefined) throw new Error("there is no provenance");
    args.push("--provenance", only);
    args.push(
      "--stage",
      stage,
      "--manifest",
      merged,
      "--public-key",
      keys.publicKey,
      "--key-id",
      KEY_ID,
      "--require-provenance",
    );
    const result = run("bun", args);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("has no provenance");
  });

  // --- el gate de publicación -----------------------------------------------

  /** Una copia del staging, para romperlo sin romper el fixture. */
  async function copyReleaseStage(name: string): Promise<string> {
    const copy = join(scratch, name);
    await cp(stage, copy, { recursive: true });
    return copy;
  }

  /** Corre el gate y exige que falle con el mensaje dado. */
  function gateRefuses(args: readonly string[], expected: string | readonly string[]): IResult {
    const result = run("bun", args);
    expect(result.status, result.output).toBe(1);
    for (const message of typeof expected === "string" ? [expected] : expected) {
      expect(result.output, `the gate does not say "${message}"`).toContain(message);
    }
    return result;
  }

  test.skipIf(!HAS_OPENSSL)("el gate no publica un artefacto sin firmar", () => {
    // Los artefactos de macOS y Windows no se pueden firmar en Linux: sin
    // `--allow-unsigned`, la release no sale.
    gateRefuses(["run", PUBLISH_GATE, "--stage", stage, "--manifest", merged], [
      "the release does not attach an unsigned artifact",
    ]);
  });

  test.skipIf(!HAS_OPENSSL)("el gate no publica un staging vacío", async () => {
    const empty = await tempDir("tanit-empty-stage");
    gateRefuses(["run", PUBLISH_GATE, "--stage", empty, "--manifest", merged], [
      "the staging holds nothing that the release would attach",
    ]);
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta un manifest que no está", async () => {
    const copy = await copyReleaseStage("stage-without-manifest");
    await rm(join(copy, "release-manifest.json"), { force: true });
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", merged, "--allow-unsigned"],
      ["the release does not attach the merged manifest"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no publica una release que no cubre la matriz", async () => {
    // Se cae el artefacto que cubre un target de la matriz: el glob
    // sigue encontrando ficheros, pero la release ya no cubre el
    // target, y el recuento de ficheros no lo ve.
    const manifest = JSON.parse(await readFile(merged, "utf8")) as IManifestJson;
    const artifact = manifest.artifacts.find((candidate) => candidate.bundle === "appimage");
    expect(artifact, "the release has no appimage").toBeDefined();
    manifest.artifacts = manifest.artifacts.filter((candidate) => candidate !== artifact);
    const path = join(scratch, "uncovered-target.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", stage, "--manifest", path, "--allow-unsigned"],
      ["the release does not cover the target"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta dos ficheros con el mismo nombre", async () => {
    const copy = await copyReleaseStage("stage-with-duplicates");
    const deb = join(copy, "linux", "x64", "deb", `Tanit_${VERSION}_x64.deb`);
    const twin = join(copy, "windows", "x64", "deb");
    await mkdir(twin, { recursive: true });
    await writeFile(join(twin, `Tanit_${VERSION}_x64.deb`), "otro\n", "utf8");
    expect(deb).toBeDefined();
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", merged, "--allow-unsigned"],
      ["they would overwrite each other"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta un fichero que el manifest no describe", async () => {
    const copy = await copyReleaseStage("stage-with-extra");
    await writeFile(join(copy, "linux", "x64", "deb", "extra.deb"), "extra\n", "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", merged, "--allow-unsigned"],
      ["the release attaches it, but the manifest does not describe it"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta un artefacto que no está en el staging", async () => {
    const copy = await copyReleaseStage("stage-without-artifact");
    await rm(join(copy, "linux", "x64", "deb", `Tanit_${VERSION}_x64.deb`), { force: true });
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", merged, "--allow-unsigned"],
      ["the manifest describes it, but it is not in the staging"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta un artefacto fuera de la lista", async () => {
    const copy = await copyReleaseStage("stage-with-unlisted");
    const notes = join(copy, "linux", "x64", "notes.txt");
    await writeFile(notes, "notas\n", "utf8");
    const manifest = JSON.parse(await readFile(merged, "utf8")) as IManifestJson;
    const artifact = manifest.artifacts[0];
    if (artifact === undefined) throw new Error("the manifest describes nothing");
    artifact.path = "linux/x64/notes.txt";
    const path = join(scratch, "unlisted-manifest.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", path, "--allow-unsigned"],
      ["the release does not attach it"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta un asset de transparencia fuera de la lista", async () => {
    const copy = await copyReleaseStage("stage-with-unlisted-asset");
    const notes = join(copy, "linux", "x64", "sbom", "notes.txt");
    await writeFile(notes, "notas\n", "utf8");
    const manifest = JSON.parse(await readFile(merged, "utf8")) as IManifestJson;
    const asset = manifest.assets.find((candidate) => candidate.kind === "sbom");
    if (asset === undefined) throw new Error("the manifest describes no SBOM");
    asset.path = "linux/x64/sbom/notes.txt";
    const path = join(scratch, "unlisted-asset-manifest.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", copy, "--manifest", path, "--allow-unsigned"],
      ['the release does not attach the "sbom" asset'],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no adjunta una clave pública que no está versionada", async () => {
    // La clave se adjunta por su ruta en el repositorio: si el
    // repositorio no la tiene, la release sale sin la clave que hace
    // verificable la attestation.
    const root = await fakeRootWithoutPublicKey(scratch);
    gateRefuses(
      [
        "run",
        join(root, "scripts", "release", "publish-gate.mjs"),
        "--stage",
        stage,
        "--manifest",
        merged,
        "--allow-unsigned",
      ],
      ["the versioned public key of the attestation is missing"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no lee un manifest que no existe", () => {
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", stage, "--manifest", join(scratch, "ghost.json")],
      ["The merged manifest does not exist"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no lee un manifest que no se puede parsear", async () => {
    const path = join(scratch, "unparseable-manifest.json");
    await writeFile(path, "esto no es json\n", "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", stage, "--manifest", path, "--allow-unsigned"],
      ["The manifest could not be parsed"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate no acepta un schema que no conoce", async () => {
    const manifest = JSON.parse(await readFile(merged, "utf8")) as IManifestJson;
    manifest.schema = "tanit.release.manifest/v99";
    const path = join(scratch, "wrong-schema.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    gateRefuses(
      ["run", PUBLISH_GATE, "--stage", stage, "--manifest", path, "--allow-unsigned"],
      ["Unexpected manifest schema"],
    );
  });

  test.skipIf(!HAS_OPENSSL)("el gate exige el staging", () => {
    gateRefuses(["run", PUBLISH_GATE, "--manifest", merged], "`--stage` is required");
  });
});


// --- el workflow, leído como YAML -------------------------------------------

/** El workflow de la release de escritorio. */
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "release-desktop.yml");

/** Un paso de un job del workflow. */
interface IWorkflowStep {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}

/** Un job del workflow. */
interface IWorkflowJob {
  readonly needs?: unknown;
  readonly if?: unknown;
  readonly runs_on?: unknown;
  readonly steps: readonly IWorkflowStep[];
}

/** El workflow completo. */
interface IWorkflow {
  readonly jobs: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * El workflow, parseado como YAML.
 *
 * El test no comprueba que el fichero contenga una cadena: comprueba que
 * el workflow **haga** una cosa. Un `grep` sobre el YAML pasa igual con
 * un paso commented-out.
 */
async function workflowDocument(): Promise<IWorkflow> {
  const script = `const text = await Bun.file(${JSON.stringify(WORKFLOW)}).text(); console.log(JSON.stringify(Bun.YAML.parse(text)));`;
  const result = run("bun", ["-e", script]);
  expect(result.status, result.output).toBe(0);
  return JSON.parse(result.stdout) as IWorkflow;
}

/** El paso del job cuyo nombre contiene el texto buscado. */
function stepNamed(job: IWorkflowJob | undefined, needle: string): IWorkflowStep | undefined {
  return (job?.steps ?? []).find((step) => (step.name ?? "").includes(needle));
}

/**
 * La comparación de los dos digests, tal y como la escribe el shell.
 *
 * Es lo que dice que la clave del secreto **es** la clave versionada.
 * Se busca con una expresión regular y no con una cadena literal
 * porque el quoting del shell cambia —`"${secret_digest}"` o
 * `"$secret_digest"`— y lo que no puede cambiar es que los dos
 * digests se comparen.
 */
const DIGEST_COMPARISON = /secret_digest[\}"]*\s*!=\s*["$\{]*published_digest/;

describe("el workflow de la release", () => {
  test("el SBOM y la attestation se construyen solo cuando se firma", async () => {
    const workflow = await workflowDocument();
    const build = workflow.jobs.build;
    expect(build, "the workflow has no build job").toBeDefined();

    // Sin firmar no hay clave de attestation, y un paso que la exige
    // mataba el job de un `workflow_dispatch` de desarrollo.
    const step = stepNamed(build, "Construir el SBOM");
    expect(step, "the workflow does not build the SBOM").toBeDefined();
    expect(step?.if ?? "").toContain("steps.policy.outputs.sign == 'true'");

    // Y ningún paso que construya el SBOM puede correr sin firmar.
    for (const candidate of build?.steps ?? []) {
      if ((candidate.run ?? "").includes("build-sbom.mjs")) {
        expect(candidate.if ?? "", candidate.name ?? "the step").toContain(
          "steps.policy.outputs.sign == 'true'",
        );
      }
    }

    // Y tampoco el que **vuelve a medir**: es el paso que hace que el
    // manifest describa el SBOM, la provenance y la attestation. Sin
    // firmar, ese paso no tiene por qué correr —no hay nada que
    // medir—; con firmar, sin él, el manifest no los menciona y el
    // gate de publicación los echa.
    const remeasure = stepNamed(build, "Volver a medir los artefactos");
    expect(remeasure, "the workflow does not measure the artifacts again").toBeDefined();
    expect(remeasure?.if ?? "", remeasure?.name ?? "the step").toContain(
      "steps.policy.outputs.sign == 'true'",
    );

    // La regla, sin depender del nombre del paso: **todo** lo que
    // vuelve a medir después de construir el SBOM depende de la firma.
    const steps = build?.steps ?? [];
    const sbomIndex = steps.findIndex((candidate) =>
      (candidate.run ?? "").includes("build-sbom.mjs"),
    );
    expect(sbomIndex, "the workflow does not build the SBOM").toBeGreaterThanOrEqual(0);
    for (const candidate of steps.slice(sbomIndex + 1)) {
      if (!(candidate.run ?? "").includes("prepare-artifacts.mjs")) continue;
      expect(candidate.if ?? "", candidate.name ?? "the step").toContain(
        "steps.policy.outputs.sign == 'true'",
      );
    }

    // Y la clave que firma la attestation es la del contrato: su
    // `keyid` y el nombre del fichero versionado son la misma
    // rotación, y una rotación que se queda a medias rompe en silencio.
    const keyId = /--key-id\s+"([^"]+)"/.exec(step?.run ?? "")?.[1];
    expect(keyId, "the build step does not pass a key id").toBeDefined();
    expect(keyId).toBe(SBOM_DEFAULT_KEY_ID);
  });

  test("el workflow compara el DER de la clave del secreto con el de la versionada", async () => {
    const workflow = await workflowDocument();
    const build = workflow.jobs.build;
    const publish = workflow.jobs.publish;
    expect(build, "the workflow has no build job").toBeDefined();
    expect(publish, "the workflow has no publish job").toBeDefined();

    // Los dos sitios donde la clave del secreto y la versionada se
    // comparan: al preparar la clave y al verificar la attestation.
    const keyStep = stepNamed(build, "Preparar la clave de attestation");
    const verifyStep = stepNamed(publish, "Verificar el SBOM y la attestation");
    expect(keyStep, "the workflow does not prepare the attestation key").toBeDefined();
    expect(verifyStep, "the workflow does not verify the attestation").toBeDefined();

    for (const step of [keyStep, verifyStep]) {
      const command = step?.run ?? "";
      const name = step?.name ?? "the step";
      // El digest va sobre el DER: el PEM tiene dos formatos y el DER
      // no, así que el digest del DER es el de la clave y no el de una
      // manera de escribirla.
      expect(command, name).toContain("-outform DER");
      expect(command, name).toContain("sha256sum");
      // Y la comparación de los dos digests: ése es el control. Si
      // desaparece, el secreto puede ser otra clave y la attestation
      // que sale firmada con ella no la verifica nadie.
      expect(command, name).toMatch(DIGEST_COMPARISON);
    }

    // Y ningún otro paso puede saltársela: donde se deriva el digest
    // del secreto, se compara con el de la clave versionada.
    const comparing = [...(build?.steps ?? []), ...(publish?.steps ?? [])].filter(
      (step) => (step.run ?? "").includes("secret_digest"),
    );
    expect(comparing.length).toBeGreaterThanOrEqual(2);
    for (const step of comparing) {
      expect(step.run ?? "", step.name ?? "the step").toMatch(DIGEST_COMPARISON);
    }
  });

  test("la publicación exige el SBOM verificado y el gate que decide los assets", async () => {
    const workflow = await workflowDocument();
    const publish = workflow.jobs.publish;
    expect(publish, "the workflow has no publish job").toBeDefined();

    // El verificador del SBOM: con la clave pública **versionada**, con
    // el manifest del updater y con el commit de la build.
    const verify = stepNamed(publish, "Verificar el SBOM");
    expect(verify, "the workflow does not verify the SBOM").toBeDefined();
    const command = verify?.run ?? "";
    expect(command).toContain("verify-sbom.mjs");
    expect(command).toContain("--require-update-manifest");
    expect(command).toContain("--public-key");
    expect(command).toContain("--commit");
    expect(command).toContain("--require-provenance");
    // La clave pública es la **del contrato**, no un literal escrito
    // aquí: una rotación cambia el fichero y el identificador, y el
    // test avisa si el workflow se queda atrás.
    expect(command).toContain(SBOM_ATTESTATION_PUBLIC_KEY_PATH);
    const keyId = /--key-id\s+"([^"]+)"/.exec(command)?.[1];
    expect(keyId, "the publish step does not pass a key id").toBeDefined();
    expect(keyId).toBe(SBOM_DEFAULT_KEY_ID);

    // Y lo que se adjunta lo decide el gate, no una lista escrita en el
    // workflow: si los dos se separan, el gate deja de gatear.
    const gate = stepNamed(publish, "Calcular y comprobar los assets");
    expect(gate?.run ?? "").toContain("publish-gate.mjs");
    expect(gate?.run ?? "").toContain("--list");
    const attach = stepNamed(publish, "Adjuntar a la release");
    expect(String(attach?.with?.files ?? "")).toContain("steps.assets.outputs.files");
  });

  test("la publicación exige la firma y verifica antes de adjuntar nada", async () => {
    const workflow = await workflowDocument();
    const publish = workflow.jobs.publish;
    expect(publish, "the workflow has no publish job").toBeDefined();
    const steps = publish?.steps ?? [];

    // El paso que exige la firma. Sin él, una release sin firmar se
    // publicaría igual, y con ella la attestation no habría nada que
    // verificar.
    const demand = stepNamed(publish, "Exigir la firma");
    expect(demand, "the workflow does not demand the signature").toBeDefined();
    // Y no puede saltársele: el paso no lleva condición.
    expect(demand?.if, "the step that demands the signature can be skipped").toBeUndefined();
    const command = demand?.run ?? "";
    expect(command).toContain(".plugins.tanit.options.release.sign");
    expect(command).toContain("exit 1");
    // Y la comparación de verdad: sin ella el paso no falla cuando no
    // se firma. Un `if false` deja el paso con su `exit 1` y su
    // `release.sign`, y la release sale sin firmar: el control es la
    // comparación, no la palabra.
    expect(command).toMatch(/if \[ "\$\{SIGN\}" != "true" \]; then/);

    // Y el orden es el del job: exigir la firma, verificar el SBOM y
    // sólo entonces adjuntar. Un paso de adjuntar antes de verificar
    // publicaría lo que no se ha comprobado.
    const indexOf = (needle: string): number =>
      steps.findIndex((step) => (step.name ?? "").includes(needle));
    const demandIndex = indexOf("Exigir la firma");
    const verifyIndex = indexOf("Verificar el SBOM");
    const attachIndex = indexOf("Adjuntar a la release");
    expect(demandIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(demandIndex);
    expect(attachIndex).toBeGreaterThan(verifyIndex);
  });
});

describe("la clave pública de la attestation", () => {
  test("está versionada y es una clave Ed25519", async () => {
    const path = join(REPO_ROOT, SBOM_ATTESTATION_PUBLIC_KEY_PATH);
    const pem = await readFile(path, "utf8");
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");

    const info = run("openssl", ["pkey", "-pubin", "-in", path, "-noout", "-text"]);
    expect(info.status, info.output).toBe(0);
    expect(info.output).toContain("ED25519");
  });
});

// --- la política de seguridad, leída como tabla ---------------------------

/** El documento de seguridad. */
const SECURITY_DOC = join(REPO_ROOT, "SECURITY.md");

/** Una fila de la tabla de las claves de la release. */
interface IReleaseKeyRow {
  /** El nombre de la clave, sin las marcas de negrita. */
  readonly key: string;
  /** El identificador de la clave, sin las marcas de código. */
  readonly identifier: string;
}

/**
 * Las filas de §4.5 de `SECURITY.md`.
 *
 * La tabla es la que dice qué clave firma qué, así que se lee **como
 * tabla** y no como texto: lo que importa no es que el documento
 * mencione tres claves, sino que las tres filas tengan **tres**
 * identificadores distintos. Una fila que copie el identificador de
 * otra es exactamente el error que la propia tabla dice evitar.
 */
async function releaseKeyRows(): Promise<IReleaseKeyRow[]> {
  const text = await readFile(SECURITY_DOC, "utf8");
  const start = text.indexOf("### 4.5.");
  expect(start, "SECURITY.md has no §4.5").toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows: IReleaseKeyRow[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const name = cells[0];
    const identifier = cells[1];
    if (name === undefined || identifier === undefined) continue;
    rows.push({
      key: name.replaceAll("*", "").replaceAll("`", "").trim(),
      identifier: identifier.replaceAll("`", "").trim(),
    });
  }
  return rows;
}

describe("la política de seguridad", () => {
  test("las tres claves de la release tienen tres identificadores distintos", async () => {
    const rows = await releaseKeyRows();
    const gpg = rows.find((row) => row.key.includes("GPG de la release"));
    const updater = rows.find((row) => row.key.includes("Ed25519 del updater"));
    const attestation = rows.find((row) => row.key.includes("Ed25519 de la attestation"));
    expect(gpg, "SECURITY.md §4.5 does not name the GPG key").toBeDefined();
    expect(updater, "SECURITY.md §4.5 does not name the updater key").toBeDefined();
    expect(attestation, "SECURITY.md §4.5 does not name the attestation key").toBeDefined();

    // La de attestation, con el identificador del contrato: el que va
    // en el `keyid` de cada envelope DSSE.
    expect(attestation?.identifier).toBe(SBOM_DEFAULT_KEY_ID);
    // La del updater, con el nombre de su clave versionada.
    expect(updater?.identifier).toBe(basename(UPDATE_PUBLIC_KEY_PATH, ".pem"));
    // Y la de GPG, con el identificador que dice su secreto.
    expect(gpg?.identifier).toContain("TANIT_SIGN_GPG_KEY_ID");

    // Los tres son **tres**: confundir la de attestation con la de GPG
    // es justo lo que la tabla dice que no pasa, y es lo que hace que
    // una attestation se verifique con la clave equivocada.
    const identifiers = [gpg?.identifier, updater?.identifier, attestation?.identifier];
    expect(new Set(identifiers).size).toBe(3);
    expect(attestation?.identifier).not.toContain("TANIT_SIGN_GPG_KEY_ID");
    expect(attestation?.identifier).not.toBe(gpg?.identifier);
  });
});

// --- cada control del verificador, atado a una prueba ----------------------
//
// ## Qué es esta sección
//
// Un control de seguridad vale lo que vale su prueba. Si el verificador
// deja de comprobar la firma y la suite sigue verde, el control no
// existe: lo único que dice es que nadie lo ha mirado.
//
// Aquí **cada** control del verificador tiene una prueba que falla si el
// control desaparece, y cada prueba parte de la salida real del
// constructor —el staging, el SBOM, la provenance y la attestation de
// verdad— y lo rompe por un solo camino.
//
// ## Lo que las pruebas hacen y lo que no
//
// No comprueban que el verificador acepte un SBOM bueno: eso ya está
// arriba. Comprueban que **cada** control tiene una prueba que lo
// ata, y que la mutación que lo rompe es la que dice el mensaje del
// control. Un control sin prueba es un control que no existe.
//
// ## Los controles que no tienen prueba
//
// Los hay, y son cuatro, y están aquí abajo con su motivo: los que
// dependen de que el repo esté roto (el `Cargo.toml` del escritorio
// ilegible), los que dependen de que `openssl` no esté (la firma no se
// puede ni comprobar), los que son defensivos y no se pueden alcanzar
// (`there is no SBOM to verify` — para llegar a él el SBOM tiene que
// haber fallado antes, y entonces ya hay un problema) y los que la
// **semántica de los patrones** hace imposibles (el gate no puede
// adjuntar dos ficheros con el mismo nombre: los patrones de
// publicación no lo permiten).
describe("cada control del verificador del SBOM está atado a una prueba", () => {
  let scratch = "";
  let stage = "";
  let keys: IAttestationKeys | null = null;
  let platform: IPlatformRelease | null = null;
  let updateManifest = "";

  beforeAll(async () => {
    scratch = await tempDir("tanit-sbom-guards");
    stage = await dryRunStaging("tanit-sbom-guards-stage");
    const attestationKeys = createAttestationKeys(scratch);
    keys = attestationKeys;
    if (attestationKeys === null) return;
    platform = await platformRelease(stage, "linux", "x64", attestationKeys);
    const updaterDir = join(scratch, "updater");
    await mkdir(updaterDir, { recursive: true });
    updateManifest = join(updaterDir, "latest.json");
    const update = run("bun", [
      "run",
      BUILD_UPDATE,
      "--stage",
      stage,
      "--manifest",
      platform.manifest,
      "--out",
      updaterDir,
      "--key",
      attestationKeys.key,
      "--version",
      VERSION,
      "--commit",
      COMMIT,
    ]);
    expect(update.status, update.output).toBe(0);
  });

  afterAll(async () => {
    if (scratch !== "") await rm(scratch, { recursive: true, force: true });
    if (stage !== "") await rm(stage, { recursive: true, force: true });
  });

  /** Los fixtures, o un error si no se pudieron construir. */
  function fx(): { stage: string; keys: IAttestationKeys; platform: IPlatformRelease } {
    if (keys === null || platform === null) throw new Error("the fixture could not be built");
    return { stage, keys, platform };
  }

  /** Los argumentos de una verificación que tiene que salir bien. */
  function baseArgs(): string[] {
    const { keys: k, platform: p } = fx();
    return [
      "run",
      VERIFY_SBOM,
      "--sbom",
      p.sbom,
      "--attestation",
      p.attestation,
      "--provenance",
      p.provenance,
      "--stage",
      stage,
      "--manifest",
      p.manifest,
      "--public-key",
      k.publicKey,
      "--key-id",
      KEY_ID,
    ];
  }

  /** Quita una bandera (y su valor) de los argumentos. */
  function without(args: readonly string[], flag: string): string[] {
    const copy = [...args];
    const index = copy.indexOf(flag);
    if (index >= 0) copy.splice(index, 2);
    return copy;
  }

  /** Los argumentos de base con otro SBOM y otra attestation. */
  function argsWith(sbom: string, attestation: string, extra: readonly string[] = []): string[] {
    const args = without(without(baseArgs(), "--sbom"), "--attestation");
    return [...args, "--sbom", sbom, "--attestation", attestation, ...extra];
  }

  /** Corre el verificador y exige que falle con los mensajes dados. */
  function rejects(args: readonly string[], expected: readonly string[]): IResult {
    const result = run("bun", args);
    expect(result.status, result.output).toBe(1);
    for (const message of expected) {
      expect(result.output, `the verifier does not say "${message}"`).toContain(message);
    }
    return result;
  }

  /**
   * Escribe un SBOM y la attestation que vuelve a describirlo.
   *
   * Sin el reselado, cualquier cambio en el SBOM rompería el enlace con
   * la attestation y el único fallo sería «la attestation es de otra
   * build»: el control que se quiere probar no se vería nunca.
   */
  async function sealSbom(
    name: string,
    document: unknown,
  ): Promise<{ sbom: string; attestation: string }> {
    const { keys: k, platform: p } = fx();
    const sbom = await writeSbom(join(scratch, `${name}.cdx.json`), document);
    const digest = await sha256Of(sbom);
    const envelope = resealStatement(
      await readEnvelope(p.attestation),
      (statement) => {
        const subject = statement.subject.find((candidate) => candidate.name.endsWith(".cdx.json"));
        if (subject !== undefined) subject.digest.sha256 = digest;
      },
      k.key,
      scratch,
    );
    const attestation = await writeEnvelope(
      join(scratch, `${name}.intoto.jsonl`),
      envelope,
    );
    return { sbom, attestation };
  }

  /**
   * Escribe un SBOM editado y la attestation que vuelve a describirlo.
   *
   * La edición es con los tipos del SBOM bueno: lo que se rompe es un
   * **valor**, no la forma del documento.
   */
  async function mutateSbom(
    name: string,
    mutate: (document: ISbomJson) => void,
  ): Promise<{ sbom: string; attestation: string }> {
    const { platform: p } = fx();
    const document = await readSbom(p.sbom);
    mutate(document);
    return sealSbom(name, document);
  }

  /**
   * Lo mismo, pero editando la **forma**: lo que llega al verificador es
   * JSON, y el JSON puede no ser un objeto donde se espera uno.
   */
  async function mutateRawSbom(
    name: string,
    mutate: (document: IRawSbomJson) => void,
  ): Promise<{ sbom: string; attestation: string }> {
    const { platform: p } = fx();
    const document = JSON.parse(await readFile(p.sbom, "utf8")) as IRawSbomJson;
    mutate(document);
    return sealSbom(name, document);
  }

  /** Escribe un manifest editado y devuelve su ruta. */
  async function mutateManifest(
    name: string,
    mutate: (manifest: IManifestJson) => void,
  ): Promise<string> {
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    mutate(manifest);
    const path = join(scratch, `${name}.json`);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return path;
  }

  /** Escribe un manifest del updater editado y devuelve su ruta. */
  async function mutateUpdateManifest(
    name: string,
    mutate: (manifest: IUpdateManifestJson) => void,
  ): Promise<string> {
    const manifest = JSON.parse(await readFile(updateManifest, "utf8")) as IUpdateManifestJson;
    mutate(manifest);
    const path = join(scratch, `${name}.json`);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return path;
  }

  /** Quita del grafo las entradas que ya no tienen componente. */
  function pruneGraph(document: ISbomJson): void {
    const refs = new Set(document.components.map((component) => component["bom-ref"]));
    document.dependencies = document.dependencies.filter((entry) => refs.has(entry.ref));
  }

  test("la línea de base verifica: sin ella los controles no prueban nada", () => {
    const result = run("bun", baseArgs());
    expect(result.status, result.output).toBe(0);
  });

  // --- el schema del documento ---------------------------------------------

  test("un SBOM que no es un objeto no verifica", async () => {
    const { platform: p } = fx();
    const sbom = join(scratch, "not-an-object.cdx.json");
    await writeFile(sbom, "[]\n", "utf8");
    const { attestation } = await mutateSbom("not-an-object-link", () => {});
    rejects(argsWith(sbom, attestation), ["the SBOM is not a JSON object"]);
    expect(p.sbom).toBeDefined();
  });

  test("un bomFormat que no es CycloneDX no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("bad-bomformat", (document) => {
      document.bomFormat = "SPDX";
    });
    rejects(argsWith(sbom, attestation), [`bomFormat must be "${SBOM_FORMAT}"`]);
  });

  test("un specVersion que no es 1.6 no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("bad-specversion", (document) => {
      document.specVersion = "1.5";
    });
    rejects(argsWith(sbom, attestation), [`specVersion must be "${SBOM_SPEC_VERSION}"`]);
  });

  test("un serialNumber que no es un urn:uuid no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("bad-serialnumber", (document) => {
      document.serialNumber = "not-a-urn";
    });
    rejects(argsWith(sbom, attestation), ["serialNumber must be a urn:uuid"]);
  });

  test("una versión del documento que no es un entero no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("bad-document-version", (document) => {
      document.version = 0;
    });
    rejects(argsWith(sbom, attestation), [
      "version must be an integer greater than or equal to 1",
    ]);
  });

  test("un documento sin metadatos no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-metadata", (document) => {
      delete (document as { metadata?: ISbomJson["metadata"] }).metadata;
    });
    rejects(argsWith(sbom, attestation), ["metadata is missing"]);
  });

  test("una marca de tiempo que no es un instante no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("bad-timestamp", (document) => {
      document.metadata.timestamp = "ayer";
    });
    rejects(argsWith(sbom, attestation), ["metadata.timestamp must be an ISO-8601 instant"]);
  });

  test("un documento sin componente raíz no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-root-component", (document) => {
      delete (document.metadata as { component?: ISbomComponentJson }).component;
    });
    rejects(argsWith(sbom, attestation), ["metadata.component is missing"]);
  });

  test("un documento sin ciclo de vida no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-lifecycles", (document) => {
      document.metadata.lifecycles = [];
    });
    rejects(argsWith(sbom, attestation), ["metadata.lifecycles is missing"]);
  });

  test("un proveedor que no es un objeto no verifica", async () => {
    const { sbom, attestation } = await mutateRawSbom("bad-supplier", (document) => {
      document.metadata.supplier = "Cartago";
    });
    rejects(argsWith(sbom, attestation), [
      "metadata.supplier must be an object",
      "metadata.supplier.name is missing",
    ]);
  });

  test("un proveedor sin nombre no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("nameless-supplier", (document) => {
      document.metadata.supplier = { url: ["https://example.invalid"] };
    });
    rejects(argsWith(sbom, attestation), ["metadata.supplier.name is missing"]);
  });

  // --- los componentes ------------------------------------------------------

  test("un documento sin componentes no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-components", (document) => {
      document.components = [];
    });
    rejects(argsWith(sbom, attestation), ["components is missing or empty"]);
  });

  test("un componente que no es un objeto no verifica", async () => {
    const { sbom, attestation } = await mutateRawSbom("bad-component", (document) => {
      document.components.push("zod");
    });
    rejects(argsWith(sbom, attestation), ["a component is not an object"]);
  });

  test("un componente sin bom-ref no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-bom-ref", (document) => {
      const component = document.components[0];
      if (component === undefined) throw new Error("the fixture has no components");
      delete (component as { "bom-ref"?: string })["bom-ref"];
      pruneGraph(document);
    });
    rejects(argsWith(sbom, attestation), ["a component has no bom-ref"]);
  });

  test("un componente sin nombre no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-name", (document) => {
      const component = document.components[0];
      if (component === undefined) throw new Error("the fixture has no components");
      delete (component as { name?: string }).name;
    });
    rejects(argsWith(sbom, attestation), ["a component has no name"]);
  });

  test("un componente sin tipo no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-type", (document) => {
      const component = document.components[0];
      if (component === undefined) throw new Error("the fixture has no components");
      delete (component as { type?: string }).type;
    });
    rejects(argsWith(sbom, attestation), ["has no type"]);
  });

  test("un componente sin versión no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-version", (document) => {
      const component = document.components[0];
      if (component === undefined) throw new Error("the fixture has no components");
      delete (component as { version?: string }).version;
    });
    rejects(argsWith(sbom, attestation), ["has no version"]);
  });

  test("un bom-ref repetido no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("duplicate-ref", (document) => {
      const component = document.components[0];
      if (component === undefined) throw new Error("the fixture has no components");
      document.components.push({ ...component });
    });
    rejects(argsWith(sbom, attestation), ["is used twice"]);
  });

  test("un algoritmo de hash desconocido no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("unknown-alg", (document) => {
      const component = document.components.find((candidate) => candidate.hashes !== undefined);
      const hash = component?.hashes?.[0];
      if (hash === undefined) throw new Error("the fixture has no hashes");
      hash.alg = "MD5";
    });
    rejects(argsWith(sbom, attestation), [
      "declares an unknown hash algorithm",
      "has a malformed MD5 digest",
    ]);
  });

  test("un digest malformado no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("malformed-digest", (document) => {
      const component = document.components.find((candidate) => candidate.hashes !== undefined);
      const hash = component?.hashes?.[0];
      if (hash === undefined) throw new Error("the fixture has no hashes");
      hash.content = "0".repeat(10);
    });
    rejects(argsWith(sbom, attestation), ["has a malformed SHA-256 digest"]);
  });

  // --- el grafo de dependencias --------------------------------------------

  test("un documento sin grafo no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-graph", (document) => {
      delete (document as { dependencies?: ISbomJson["dependencies"] }).dependencies;
    });
    rejects(argsWith(sbom, attestation), [
      "dependencies is missing",
      "the attestation does not describe any of the SBOMs",
    ]);
  });

  test("una entrada del grafo que no es un objeto no verifica", async () => {
    const { sbom, attestation } = await mutateRawSbom("bad-entry", (document) => {
      document.dependencies.push("zod");
    });
    rejects(argsWith(sbom, attestation), ["a dependency entry is not an object"]);
  });

  test("una entrada del grafo sin ref no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-ref", (document) => {
      const entry = document.dependencies[0];
      if (entry === undefined) throw new Error("the fixture has no graph");
      delete (entry as { ref?: string }).ref;
    });
    rejects(argsWith(sbom, attestation), ["a dependency entry has no ref"]);
  });

  test("una entrada del grafo sin dependsOn no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-dependson", (document) => {
      const entry = document.dependencies[0];
      if (entry === undefined) throw new Error("the fixture has no graph");
      delete (entry as { dependsOn?: string[] }).dependsOn;
    });
    rejects(argsWith(sbom, attestation), ["has no dependsOn"]);
  });

  test("una entrada del grafo que no corresponde a ningún componente no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("orphan-entry", (document) => {
      const entry = document.dependencies[0];
      if (entry === undefined) throw new Error("the fixture has no graph");
      entry.ref = "pkg:npm/ghost@1.0.0";
      entry.dependsOn = [];
    });
    rejects(argsWith(sbom, attestation), [
      'the dependency "pkg:npm/ghost@1.0.0" does not correspond to any component',
    ]);
  });

  test("una arista hacia un componente que no existe no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("ghost-edge", (document) => {
      const entry = document.dependencies[0];
      if (entry === undefined) throw new Error("the fixture has no graph");
      entry.dependsOn = ["pkg:npm/ghost@1.0.0"];
    });
    rejects(argsWith(sbom, attestation), [
      'points at the unknown component "pkg:npm/ghost@1.0.0"',
    ]);
  });

  // --- los secretos ---------------------------------------------------------

  test("un componente que describe un secreto no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("secret-component", (document) => {
      document.components.push({
        type: "application",
        name: "server.key",
        version: "1.0.0",
        "bom-ref": "file:linux/x64/server.key",
        hashes: [{ alg: "SHA-256", content: "0".repeat(64) }],
      });
    });
    rejects(argsWith(sbom, attestation), [
      'the component "linux/x64/server.key" describes a file that must never be published',
    ]);
  });

  // --- la cobertura de dependencias ----------------------------------------

  test("un SBOM sin la dependencia del sidecar no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("no-sidecar-dependency", (document) => {
      const removed = document.components.find((component) => component.name === "zod");
      document.components = document.components.filter((component) => component.name !== "zod");
      document.dependencies = document.dependencies.map((entry) => ({
        ...entry,
        dependsOn: entry.dependsOn.filter((ref) => ref !== removed?.["bom-ref"]),
      }));
    });
    rejects(argsWith(sbom, attestation), [
      'does not describe the dependency "zod" of the sidecar',
    ]);
  });

  test("un sidecar que no cuelga de su dependencia no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("sidecar-without-edge", (document) => {
      const sidecar = document.components.find(
        (component) => component.name === SBOM_REQUIRED_COMPONENTS[1],
      );
      const zod = document.components.find((component) => component.name === "zod");
      document.dependencies = document.dependencies.map((entry) =>
        entry.ref === sidecar?.["bom-ref"]
          ? { ...entry, dependsOn: entry.dependsOn.filter((ref) => ref !== zod?.["bom-ref"]) }
          : entry,
      );
    });
    rejects(argsWith(sbom, attestation), [
      'the sidecar does not depend on "zod" in the dependency graph',
    ]);
  });

  test("un escritorio que no cuelga de su dependencia no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("desktop-without-edge", (document) => {
      const desktop = document.components.find(
        (component) => component.name === SBOM_REQUIRED_COMPONENTS[0],
      );
      const tauri = document.components.find((component) => component.name === "tauri");
      document.dependencies = document.dependencies.map((entry) =>
        entry.ref === desktop?.["bom-ref"]
          ? { ...entry, dependsOn: entry.dependsOn.filter((ref) => ref !== tauri?.["bom-ref"]) }
          : entry,
      );
    });
    rejects(argsWith(sbom, attestation), [
      'the desktop does not depend on "tauri" in the dependency graph',
    ]);
  });

  // --- los hashes -----------------------------------------------------------

  test("un componente que no está en el staging no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("missing-from-stage", (document) => {
      document.components.push({
        type: "application",
        name: "ghost.deb",
        version: "1.0.0",
        "bom-ref": "file:linux/x64/deb/ghost.deb",
        hashes: [{ alg: "SHA-256", content: "0".repeat(64) }],
      });
    });
    rejects(argsWith(sbom, attestation), [
      'the component "linux/x64/deb/ghost.deb" is not in the staging',
    ]);
  });

  // --- el manifest de la release --------------------------------------------

  test("un manifest que no se puede leer no verifica", () => {
    rejects(
      [...without(baseArgs(), "--manifest"), "--manifest", join(scratch, "ghost-manifest.json")],
      ["the release manifest could not be read"],
    );
  });

  test("un SBOM que no cubre un artefacto del manifest no verifica", async () => {
    const { sbom, attestation } = await mutateSbom("uncovered-artifact", (document) => {
      const artifact = document.components.find((component) =>
        component["bom-ref"].startsWith("file:"),
      );
      document.components = document.components.filter(
        (component) => component !== artifact,
      );
      pruneGraph(document);
    });
    rejects(argsWith(sbom, attestation), ["the SBOM does not cover the artifact"]);
  });

  test("un digest que el manifest y el SBOM no comparten no verifica", async () => {
    const manifest = await mutateManifest("wrong-digest", (draft) => {
      const artifact = draft.artifacts[0];
      if (artifact === undefined) throw new Error("the manifest describes nothing");
      artifact.sha256 = "0".repeat(64);
    });
    rejects(
      [...without(baseArgs(), "--manifest"), "--manifest", manifest],
      [
        "the SBOM and the release manifest disagree about",
        "does not match the release manifest",
      ],
    );
  });

  test("una versión que el manifest y el SBOM no comparten no verifica", async () => {
    const manifest = await mutateManifest("wrong-artifact-version", (draft) => {
      const artifact = draft.artifacts[0];
      if (artifact === undefined) throw new Error("the manifest describes nothing");
      artifact.version = "9.9.9";
    });
    rejects(
      [...without(baseArgs(), "--manifest"), "--manifest", manifest],
      ["the SBOM and the release manifest disagree about the version of"],
    );
  });

  test("una versión de release que el manifest y el SBOM no comparten no verifica", async () => {
    const manifest = await mutateManifest("wrong-release-version", (draft) => {
      draft.version = "9.9.9";
    });
    rejects(
      [...without(baseArgs(), "--manifest"), "--manifest", manifest],
      [`the SBOM describes the version ${VERSION} and the release manifest the version 9.9.9`],
    );
  });

  test("un artefacto del manifest que no está en el staging no verifica", async () => {
    const manifest = await mutateManifest("ghost-artifact", (draft) => {
      draft.artifacts.push({
        path: "linux/x64/deb/ghost.deb",
        sha256: "0".repeat(64),
        version: VERSION,
        os: "linux",
        arch: "x64",
        bundle: "deb",
      });
    });
    rejects(
      [...without(baseArgs(), "--manifest"), "--manifest", manifest],
      [
        "the release manifest describes linux/x64/deb/ghost.deb, which is not in the staging",
        "the SBOM does not cover the artifact linux/x64/deb/ghost.deb",
      ],
    );
  });

  test("un artefacto que ha cambiado después de medirse no verifica", async () => {
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    const artifact = manifest.artifacts[0];
    if (artifact === undefined) throw new Error("the manifest describes nothing");
    const absolute = join(stage, artifact.path);
    const original = fromLatin1(readFileSync(absolute, "latin1"));
    try {
      writeFileSync(
        absolute,
        toLatin1(concatBytes([original, encodeUtf8("changed\n")])),
        "latin1",
      );
      rejects(baseArgs(), [
        "does not match the staging",
        "does not match the release manifest",
      ]);
    } finally {
      writeFileSync(absolute, toLatin1(original), "latin1");
    }
  });

  // --- el manifest del updater ---------------------------------------------

  test("un manifest del updater que no se puede leer no verifica", () => {
    rejects(
      [
        ...without(baseArgs(), "--update-manifest"),
        "--update-manifest",
        join(scratch, "ghost-latest.json"),
      ],
      ["the update manifest could not be read"],
    );
  });

  test("una versión que el updater y el manifest no comparten no verifica", async () => {
    const broken = await mutateUpdateManifest("wrong-updater-version", (draft) => {
      draft.version = "9.9.9";
    });
    rejects(
      [...without(baseArgs(), "--update-manifest"), "--update-manifest", broken],
      [`the update manifest offers the version 9.9.9 and the release manifest the version ${VERSION}`],
    );
  });

  test("un target del updater que la release no describe no verifica", async () => {
    const broken = await mutateUpdateManifest("unknown-target", (draft) => {
      const target = draft.targets[0];
      if (target === undefined) throw new Error("the updater offers nothing");
      target.arch = "riscv";
    });
    rejects(
      [...without(baseArgs(), "--update-manifest"), "--update-manifest", broken],
      ["which the release manifest does not describe"],
    );
  });

  test("un hash que el updater y el manifest no comparten no verifica", async () => {
    const broken = await mutateUpdateManifest("wrong-updater-hash", (draft) => {
      const target = draft.targets[0];
      if (target === undefined) throw new Error("the updater offers nothing");
      target.sha256 = "0".repeat(64);
    });
    rejects(
      [...without(baseArgs(), "--update-manifest"), "--update-manifest", broken],
      [
        "the update manifest and the release manifest disagree about",
        "the SBOM and the update manifest disagree about",
      ],
    );
  });

  test("un artefacto que ofrece el updater y que el SBOM no cubre no verifica", async () => {
    const manifest = await mutateManifest("updater-uncovered", (draft) => {
      const artifact = draft.artifacts[0];
      if (artifact === undefined) throw new Error("the manifest describes nothing");
      artifact.path = "linux/x64/deb/ghost.deb";
    });
    rejects(
      [
        ...without(baseArgs(), "--manifest"),
        "--manifest",
        manifest,
        "--update-manifest",
        updateManifest,
      ],
      [
        "the SBOM does not cover the artifact the updater offers: linux/x64/deb/ghost.deb",
        "the SBOM does not cover the artifact linux/x64/deb/ghost.deb",
      ],
    );
  });

  // --- la attestation -------------------------------------------------------

  test("una attestation que no existe no verifica", () => {
    rejects(
      [
        ...without(baseArgs(), "--attestation"),
        "--attestation",
        join(scratch, "ghost.intoto.jsonl"),
      ],
      ["the attestation does not exist"],
    );
  });

  test("una attestation vacía no verifica", async () => {
    const { platform: p } = fx();
    const attestation = join(scratch, "empty.intoto.jsonl");
    await writeFile(attestation, "\n", "utf8");
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation is empty"],
    );
    expect(p.attestation).toBeDefined();
  });

  test("una attestation con dos envelopes no verifica", async () => {
    const { platform: p } = fx();
    const raw = await readFile(p.attestation, "utf8");
    const attestation = join(scratch, "two-envelopes.intoto.jsonl");
    await writeFile(attestation, `${raw}${raw}`, "utf8");
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["it must be one per build"],
    );
  });

  test("una attestation que no se puede parsear no verifica", async () => {
    const attestation = join(scratch, "unparseable.intoto.jsonl");
    await writeFile(attestation, "esto no es json\n", "utf8");
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation could not be parsed"],
    );
  });

  test("una attestation cuyo envelope no es un objeto no verifica", async () => {
    const attestation = join(scratch, "envelope-array.intoto.jsonl");
    await writeFile(attestation, "[]\n", "utf8");
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation envelope is not an object"],
    );
  });

  test("una attestation con otro payloadType no verifica", async () => {
    const { keys: k, platform: p } = fx();
    const envelope = reseal(
      { ...(await readEnvelope(p.attestation)), payloadType: "application/json" },
      k.key,
      scratch,
    );
    const attestation = await writeEnvelope(join(scratch, "other-payload-type.intoto.jsonl"), envelope);
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      [`the attestation payload type must be "${SBOM_PAYLOAD_TYPE}"`],
    );
  });

  test("una attestation sin firma no verifica", async () => {
    const { platform: p } = fx();
    const envelope = { ...(await readEnvelope(p.attestation)), signatures: [] };
    const attestation = await writeEnvelope(join(scratch, "unsigned.intoto.jsonl"), envelope);
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation has no signature"],
    );
  });

  test("una attestation firmada por otra clave no verifica", () => {
    // La clave que se espera es la del contrato; la del envelope es
    // otra. Una attestation firmada por la clave equivocada no la
    // verifica nadie.
    rejects(
      [...without(baseArgs(), "--key-id"), "--key-id", "tanit-release-attestation-v2"],
      ["the attestation is signed by"],
    );
  });

  test("una attestation sin clave pública no verifica", () => {
    rejects(
      without(baseArgs(), "--public-key"),
      ["there is no public key"],
    );
  });

  test("una attestation con la firma corrupta no verifica", async () => {
    const { platform: p } = fx();
    const envelope = await readEnvelope(p.attestation);
    const attestation = await writeEnvelope(join(scratch, "corrupted.intoto.jsonl"), {
      ...envelope,
      signatures: envelope.signatures.map((entry) => ({ ...entry, sig: corruptedSignature() })),
    });
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation signature does not verify against the public key"],
    );
  });

  test("una attestation con el payload corrupto no verifica", async () => {
    const { keys: k, platform: p } = fx();
    const envelope = await readEnvelope(p.attestation);
    const payload = encodeUtf8("esto no es un statement");
    const sig = signBytes(k.key, dssePae(envelope.payloadType, payload), scratch);
    const attestation = await writeEnvelope(join(scratch, "corrupted-payload.intoto.jsonl"), {
      ...envelope,
      payload: toBase64(payload),
      signatures: envelope.signatures.map((entry) => ({ ...entry, sig })),
    });
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation payload could not be parsed"],
    );
  });

  test("una attestation con otro tipo de statement no verifica", async () => {
    const { keys: k, platform: p } = fx();
    const envelope = resealStatement(
      await readEnvelope(p.attestation),
      (statement) => {
        statement._type = "https://example.invalid/Statement/v1";
      },
      k.key,
      scratch,
    );
    const attestation = await writeEnvelope(join(scratch, "other-statement-type.intoto.jsonl"), envelope);
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the statement type must be"],
    );
  });

  test("una attestation con otro predicateType no verifica", async () => {
    const { keys: k, platform: p } = fx();
    const envelope = resealStatement(
      await readEnvelope(p.attestation),
      (statement) => {
        statement.predicateType = "https://example.invalid/provenance/v1";
      },
      k.key,
      scratch,
    );
    const attestation = await writeEnvelope(join(scratch, "other-predicate-type.intoto.jsonl"), envelope);
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the predicate type must be"],
    );
  });

  test("una attestation que no describe el artefacto no verifica", async () => {
    // La attestation firma el SBOM pero deja fuera el `.deb`: firma el
    // inventario, no lo que el inventario describe.
    const { keys: k, platform: p } = fx();
    const envelope = resealStatement(
      await readEnvelope(p.attestation),
      (statement) => {
        statement.subject = statement.subject.filter(
          (subject) => !subject.name.endsWith(".deb"),
        );
      },
      k.key,
      scratch,
    );
    const attestation = await writeEnvelope(join(scratch, "uncovered-artifact.intoto.jsonl"), envelope);
    rejects(
      [...without(baseArgs(), "--attestation"), "--attestation", attestation],
      ["the attestation does not describe the artifact"],
    );
  });

  test("una attestation construida por otro builder no verifica", () => {
    rejects(
      [...without(baseArgs(), "--builder-id"), "--builder-id", "https://example.invalid/builder"],
      ["and the expected builder is"],
    );
  });

  test("una attestation que viene de otro sitio no verifica", () => {
    rejects(
      [...without(baseArgs(), "--source"), "--source", "otra-release"],
      ["and the expected source is"],
    );
  });

  // --- la provenance --------------------------------------------------------

  test("una release sin provenance en claro no verifica", () => {
    // Las attestations están y son válidas, pero la provenance que se
    // publica no existe: la release publicaría una verdad firmada y
    // ninguna en claro.
    rejects([...without(baseArgs(), "--provenance"), "--require-provenance"], [
      "there is no provenance",
    ]);
  });

  test("una provenance que no se puede leer no verifica", () => {
    rejects(
      [
        ...without(baseArgs(), "--provenance"),
        "--provenance",
        join(scratch, "ghost.provenance.json"),
        "--require-provenance",
      ],
      ["the provenance could not be read"],
    );
  });

  test("una provenance que no es un objeto no verifica", async () => {
    const provenance = join(scratch, "provenance-array.json");
    await writeFile(provenance, "[]\n", "utf8");
    rejects(
      [...without(baseArgs(), "--provenance"), "--provenance", provenance, "--require-provenance"],
      ["is not a JSON object"],
    );
  });

  test("una provenance con otro tipo de statement no verifica", async () => {
    const { platform: p } = fx();
    const statement = JSON.parse(await readFile(p.provenance, "utf8")) as IStatementJson;
    statement._type = "https://example.invalid/Statement/v1";
    const provenance = join(scratch, "other-statement.provenance.json");
    await writeFile(provenance, `${JSON.stringify(statement, null, 2)}\n`, "utf8");
    rejects(
      [...without(baseArgs(), "--provenance"), "--provenance", provenance, "--require-provenance"],
      ["and the statement type must be"],
    );
  });

  // --- el arranque ---------------------------------------------------------

  test("una release que exige el manifest del updater y no lo tiene no verifica", () => {
    rejects([...baseArgs(), "--require-update-manifest"], [
      "there is no update manifest",
    ]);
  });

  test("un SBOM que no se puede leer no verifica", () => {
    rejects(
      [...without(baseArgs(), "--sbom"), "--sbom", join(scratch, "ghost.cdx.json")],
      ["the SBOM could not be read", "the attestation does not describe any of the SBOMs"],
    );
  });

  // --- el constructor del SBOM ----------------------------------------------
  //
  // El constructor es la otra mitad de la cadena: si él acepta un
  // staging con secretos, o un artefacto que ha cambiado, el
  // verificador recibe un documento que ya no describe lo que se
  // publica. Por eso sus controles también están atados.

  /** Una copia del staging, para romperlo sin romper el fixture. */
  async function copyStage(name: string): Promise<string> {
    const copy = join(scratch, name);
    await cp(stage, copy, { recursive: true });
    return copy;
  }

  /** Los argumentos de una construcción que tiene que salir bien. */
  function buildArgs(
    buildStage: string,
    manifest: string,
    extra: readonly string[] = [],
  ): string[] {
    const { keys: k } = fx();
    return [
      "run",
      BUILD_SBOM,
      "--stage",
      buildStage,
      "--manifest",
      manifest,
      "--key",
      k.key,
      "--sbom",
      join(scratch, "built.cdx.json"),
      "--provenance",
      join(scratch, "built.provenance.json"),
      "--attestation",
      join(scratch, "built.intoto.jsonl"),
      ...extra,
    ];
  }

  /** Corre el constructor y exige que falle con el mensaje dado. */
  function refuses(args: readonly string[], expected: string | readonly string[]): IResult {
    const result = run("bun", args);
    expect(result.status, result.output).toBe(1);
    for (const message of typeof expected === "string" ? [expected] : expected) {
      expect(result.output, `the builder does not say "${message}"`).toContain(message);
    }
    return result;
  }

  test("el constructor no acepta un staging con un secreto", async () => {
    const buildStage = await copyStage("stage-with-secret");
    await writeFile(join(buildStage, "linux", "x64", "server.key"), "un secreto\n", "utf8");
    const { platform: p } = fx();
    refuses(buildArgs(buildStage, p.manifest), ["must never be published"]);
  });

  test("el constructor no acepta un artefacto que ha cambiado", async () => {
    const buildStage = await copyStage("stage-changed");
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    const artifact = manifest.artifacts[0];
    if (artifact === undefined) throw new Error("the manifest describes nothing");
    await writeFile(join(buildStage, artifact.path), "otro contenido\n", "utf8");
    refuses(
      buildArgs(buildStage, p.manifest),
      "does not match the release manifest digest",
    );
  });

  test("el constructor no acepta un manifest que no describe artefactos", async () => {
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    manifest.artifacts = [];
    const path = join(scratch, "no-artifacts.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refuses(buildArgs(stage, path), "The release manifest describes no artifact");
  });

  test("el constructor no acepta un manifest sin versión", async () => {
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    delete (manifest as { version?: string }).version;
    const path = join(scratch, "no-version.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refuses(buildArgs(stage, path), "Could not determine the version of the release");
  });

  test("el constructor no acepta un manifest de varias plataformas", async () => {
    const { platform: p } = fx();
    const manifest = await readManifest(p.manifest);
    const artifact = manifest.artifacts[0];
    if (artifact === undefined) throw new Error("the manifest describes nothing");
    manifest.artifacts.push({ ...artifact, os: "windows", path: "windows/x64/msi/other.msi" });
    const path = join(scratch, "many-platforms.json");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    refuses(buildArgs(stage, path), "an SBOM describes one platform");
  });

  test("el constructor no acepta un sistema que no conoce", () => {
    const { platform: p } = fx();
    refuses(buildArgs(stage, p.manifest, ["--os", "plan9"]), 'Unknown os "plan9"');
  });

  test("el constructor no construye sin clave", () => {
    const { platform: p } = fx();
    const args = buildArgs(stage, p.manifest);
    const index = args.indexOf("--key");
    args.splice(index, 2);
    refuses(args, "No attestation key");
  });

  test("el constructor no firma con algo que no es una clave", async () => {
    const { platform: p } = fx();
    const notAKey = join(scratch, "not-a-key.pem");
    await writeFile(notAKey, "esto no es una clave\n", "utf8");
    const args = buildArgs(stage, p.manifest);
    const index = args.indexOf("--key");
    args.splice(index, 2, "--key", notAKey);
    refuses(args, "openssl could not sign the attestation");
  });

  test("el constructor no lee un manifest que no existe", () => {
    refuses(
      buildArgs(stage, join(scratch, "ghost-manifest.json")),
      "Could not read the release manifest",
    );
  });

  test("el constructor no construye sin el manifest de la release", () => {
    // Sin manifest no hay artefactos que medir: el constructor no
    // tiene nada que describir, y un SBOM sin artefactos no describe
    // el producto.
    const { keys: k } = fx();
    const result = run("bun", [
      "run",
      BUILD_SBOM,
      "--stage",
      stage,
      "--key",
      k.key,
      "--sbom",
      join(scratch, "no-manifest.cdx.json"),
      "--provenance",
      join(scratch, "no-manifest.provenance.json"),
      "--attestation",
      join(scratch, "no-manifest.intoto.jsonl"),
    ]);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("`--manifest` is required");
  });

  test("el constructor exige el staging", () => {
    // Sin staging no hay nada que medir: el constructor no puede
    // describir un producto que no ha visto.
    const { keys: k, platform: p } = fx();
    const result = run("bun", [
      "run",
      BUILD_SBOM,
      "--manifest",
      p.manifest,
      "--key",
      k.key,
      "--sbom",
      join(scratch, "no-stage.cdx.json"),
      "--provenance",
      join(scratch, "no-stage.provenance.json"),
      "--attestation",
      join(scratch, "no-stage.intoto.jsonl"),
    ]);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("`--stage` is required");
  });

  // --- los controles que dependen del entorno y del repo ------------------
  //
  // Estos no se pueden provocar con el fixture: hace falta que
  // `openssl` no esté, o que el repo esté roto. Los dos se hacen sin
  // tocar el repo de verdad: sin `openssl` en el `PATH`, y con una raíz
  // de repo falsa —las mismas fuentes, en otro sitio—.

  test("el verificador no puede comprobar la firma sin openssl", () => {
    // Sin `openssl` la firma no se puede ni comprobar. Una attestation
    // cuya firma nadie ha comprobado es una afirmación sin prueba: el
    // verificador tiene que decirlo y parar.
    const empty = join(scratch, "empty-bin");
    const result = run(BUN, baseArgs(), { ...process.env, PATH: empty });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("the attestation signature could not be checked");
  });

  test("el verificador no puede cubrir las dependencias del escritorio si no las puede leer", async () => {
    // Las dependencias del escritorio salen del `Cargo.toml` del repo.
    // Si no se puede leer, el verificador no puede decir qué lleva el
    // binario: un SBOM sin la cobertura de las crates describe un
    // producto que no existe.
    const root = await fakeRepo(scratch, "fake-root-no-desktop", ["verify-sbom.mjs"]);
    // Un `Cargo.toml` que es un directorio: leerlo falla con EISDIR.
    await mkdir(join(root, "packages", "desktop", "Cargo.toml"), { recursive: true });
    const args = baseArgs();
    args[1] = join(root, "scripts", "release", "verify-sbom.mjs");
    const result = run("bun", args);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("the desktop dependencies could not be read");
  });

  test("el constructor no construye sin las dependencias de runtime", async () => {
    // El grafo de Bun sale del `bun.lock`. Si no tiene las raíces de
    // runtime, el sidecar saldría vacío: el SBOM describiría un
    // producto sin nada dentro.
    const root = await fakeRepo(scratch, "fake-root-no-bun", ["build-sbom.mjs"]);
    await mkdir(join(root, "packages", "desktop"), { recursive: true });
    await copyFile(
      join(REPO_ROOT, "packages", "desktop", "Cargo.lock"),
      join(root, "packages", "desktop", "Cargo.lock"),
    );
    await copyFile(
      join(REPO_ROOT, "packages", "desktop", "Cargo.toml"),
      join(root, "packages", "desktop", "Cargo.toml"),
    );
    // Un `bun.lock` que no declara ninguna dependencia.
    await writeFile(join(root, "bun.lock"), '{"packages":{}}\n', "utf8");
    const { keys: k, platform: p } = fx();
    const result = run("bun", [
      "run",
      join(root, "scripts", "release", "build-sbom.mjs"),
      "--stage",
      stage,
      "--manifest",
      p.manifest,
      "--key",
      k.key,
      "--sbom",
      join(scratch, "fake-bun.cdx.json"),
      "--provenance",
      join(scratch, "fake-bun.provenance.json"),
      "--attestation",
      join(scratch, "fake-bun.intoto.jsonl"),
    ]);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("None of the runtime dependencies are in bun.lock");
  });

  test("el constructor no firma sin openssl", () => {
    const { keys: k, platform: p } = fx();
    const empty = join(scratch, "empty-bin");
    const result = run(
      BUN,
      [
        "run",
        BUILD_SBOM,
        "--stage",
        stage,
        "--manifest",
        p.manifest,
        "--key",
        k.key,
        "--sbom",
        join(scratch, "no-openssl.cdx.json"),
        "--provenance",
        join(scratch, "no-openssl.provenance.json"),
        "--attestation",
        join(scratch, "no-openssl.intoto.jsonl"),
      ],
      { ...process.env, PATH: empty },
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("openssl is not available");
  });
});

