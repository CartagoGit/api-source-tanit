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
 * Con `bun test` la spec también corre —los tests usan `test.skipIf`, que
 * ambas entdradas entienden—, pero el runner de referencia del repo es
 * vitest: `bun test` aborta con «0 pass, 0 fail, 2 errors» cuando la
 * spec usa API que `bun:test` no tiene, y ese «0 tests» se lee como un
 * «todo verde» que no es cierto.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import {
  SBOM_ATTESTATION_PUBLIC_KEY_PATH,
  SBOM_BUILD_TOOL_PROPERTY,
  SBOM_DEFAULT_KEY_ID,
  SBOM_PROVENANCE_PREDICATE_TYPE,
  SBOM_REQUIRED_COMPONENTS,
  SBOM_RUNS_URL,
  SBOM_SPEC_VERSION,
} from "../../packages/contracts/constants/release/sbom.constant.js";

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

/** La versión que dice la configuración de Tauri. */
const VERSION = "1.0.0";
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

/** Corre un comando y devuelve su salida. */
function run(command: string, args: readonly string[]): IResult {
  const result = spawnSync(command, [...args], { cwd: REPO_ROOT, encoding: "utf8" });
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
    supplier?: { name: string; url?: string[] };
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
  artifacts: { path: string; sha256: string; version: string }[];
  assets: IAssetJson[];
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
async function writeSbom(path: string, document: ISbomJson): Promise<string> {
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

/** Lee un SBOM. */
async function readSbom(path: string): Promise<ISbomJson> {
  return JSON.parse(await readFile(path, "utf8")) as ISbomJson;
}

/** Lee el manifest de la release. */
async function readManifest(path: string): Promise<IManifestJson> {
  return JSON.parse(await readFile(path, "utf8")) as IManifestJson;
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
    expect(document.bomFormat).toBe("CycloneDX");
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
    expect(gate.output).toContain("attestation");
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
    expect(command).toContain("tanit-release-attestation-v1.pub.pem");

    // Y lo que se adjunta lo decide el gate, no una lista escrita en el
    // workflow: si los dos se separan, el gate deja de gatear.
    const gate = stepNamed(publish, "Calcular y comprobar los assets");
    expect(gate?.run ?? "").toContain("publish-gate.mjs");
    expect(gate?.run ?? "").toContain("--list");
    const attach = stepNamed(publish, "Adjuntar a la release");
    expect(String(attach?.with?.files ?? "")).toContain("steps.assets.outputs.files");
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
