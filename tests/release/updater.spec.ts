/**
 * El updater firmado, probado de punta a punta y sin red.
 *
 * ## Qué se prueba aquí
 *
 * El **ciclo completo** del manifest de actualización: el script que
 * lo construye, el script que lo verifica y el contrato que los dos
 * comparten con el cliente nativo. Y, sobre todo, que el ciclo
 * **falla cerrado**: una firma corrupta, un hash que no cuadra, un
 * target que no es el de esta plataforma o una versión que no es
 * posterior tienen que abortar con un motivo que se puede leer, no
 * pasar con un aviso.
 *
 * ## Por qué hay tres implementaciones de las mismas reglas
 *
 * El cliente (`packages/desktop/src/updater.rs`), el constructor
 * (`scripts/release/build-update-manifest.mjs`) y este verificador
 * (`scripts/release/verify-update.sh`) son tres implementaciones
 * distintas de las mismas reglas, escritas con herramientas
 * distintas. No es duplicación por descuido: es lo que permite que
 * un error en una de ellas no se esconda detrás de las otras dos, y
 * lo que hace que la verificación del auditor sea independiente de la
 * que hace la app.
 *
 * ## Sin red, sin cuenta y sin claves privadas
 *
 * No hay red: los scripts leen y escriben en disco. No hay cuenta de
 * Apple ni de Microsoft: la firma que se prueba es Ed25519, que se
 * genera en el propio test. Y no hay ninguna clave privada en el
 * repo: la que usan las pruebas nace y muere en un directorio
 * temporal. Lo único versionado es la clave **pública**.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import {
  UPDATE_MANIFEST_FILE,
  UPDATE_MANIFEST_SCHEMA,
  UPDATE_MINIMUM_SUPPORTED_VERSION,
  UPDATE_PUBLIC_KEY_ID,
  UPDATE_SECURITY_EVENT_CODES,
  UPDATE_SIGNATURE_FILE,
} from "../../packages/contracts/constants/release/updater.constant.js";

/** El script que mide el staging y escribe el manifest de la release. */
const PREPARE = join(REPO_ROOT, "scripts", "release", "prepare-artifacts.mjs");
/** El script que construye y firma el manifest de actualización. */
const BUILD = join(REPO_ROOT, "scripts", "release", "build-update-manifest.mjs");
/** El verificador independiente. */
const VERIFY = join(REPO_ROOT, "scripts", "release", "verify-update.sh");
/** El workflow que publica la release de escritorio. */
const RELEASE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "release-desktop.yml");
/** El workflow de validación de la CI. */
const VALIDATE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "validate.yml");

// --- el workflow, leído como YAML -------------------------------------------

/** Un paso de un job del workflow. */
interface IWorkflowStep {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly working_directory?: string;
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
 * Con `bun`, que trae un parser de YAML de serie: el test **no**
 * comprueba que el fichero contenga una cadena, comprueba que el
 * workflow haga una cosa.
 */
async function workflowDocument(path = RELEASE_WORKFLOW): Promise<IWorkflow> {
  const script = `const text = await Bun.file(${JSON.stringify(path)}).text(); console.log(JSON.stringify(Bun.YAML.parse(text)));`;
  const result = run("bun", ["-e", script]);
  expect(result.status, result.output).toBe(0);
  return JSON.parse(result.stdout) as IWorkflow;
}

/** La versión que se ofrece. */
const OFFERED = "0.2.0";
/** La versión que se dice que está instalada. */
const INSTALLED = "0.1.0";
/** La plataforma de las pruebas. */
const PLATFORM = "linux/x64/deb";
/** El nombre del instalador de mentira. */
const ARTIFACT_NAME = "Tanit_0.2.0_amd64.deb";

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

/** Una clave Ed25519 efímera: la mitad privada no sale del temporal. */
interface IKey {
  readonly private: string;
  readonly public: string;
}

/** Genera la clave y extrae su mitad pública. */
function makeKey(directory: string): IKey {
  const privateKey = join(directory, "private.pem");
  const publicKey = join(directory, "public.pem");
  const generated = run("openssl", ["genpkey", "-algorithm", "ed25519", "-out", privateKey]);
  expect(generated.status, `openssl could not generate the key: ${generated.output}`).toBe(0);
  const extracted = run("openssl", ["pkey", "-in", privateKey, "-pubout", "-out", publicKey]);
  expect(extracted.status, `openssl could not extract the public key: ${extracted.output}`).toBe(0);
  return { private: privateKey, public: publicKey };
}

/**
 * Firma un fichero y devuelve la firma en base64.
 *
 * `openssl` escribe la firma en binario, así que la salida se pide
 * como buffer y se codifica aquí. El repo declara `node:fs` con
 * cadenas solamente, y una firma no es una cadena.
 */
function sign(privateKey: string, file: string): string {
  // `openssl` escribe la firma en binario, así que se pide en base64
  // desde el principio: el shell no tiene que volver a leer nada.
  const result = run("sh", [
    "-c",
    'openssl pkeyutl -sign -rawin -inkey "$1" -in "$2" | base64 | tr -d "\\n"',
    "sh",
    privateKey,
    file,
  ]);
  expect(result.status, `openssl could not sign: ${result.output}`).toBe(0);
  return result.stdout.trim();
}

/**
 * Rompe una firma en base64 sin dejar de ser una firma.
 *
 * Se cambia **un** carácter del medio: el base64 sigue siendo base64
 * y sigue mapeando a los 64 bytes de una firma Ed25519, así que el
 * verificador falla al **verificar** y no al decodificar. Si el
 * base64 dejara de ser decodificable, el fallo sería del decodificador
 * y no se probaría nada.
 */
function corruptSignature(signature: string): string {
  const index = 10;
  return `${signature.slice(0, index)}${signature[index] === "A" ? "B" : "A"}${signature.slice(index + 1)}`;
}

/** El manifest de actualización, tal y como lo escribe el script. */
interface IUpdateManifestJson {
  schema: string;
  version: string;
  minimumSupportedVersion: string;
  generatedAt: string;
  publicKeyId: string;
  signatureAlgorithm: string;
  targets: Array<{
    os: string;
    arch: string;
    bundle: string;
    url: string;
    sha256: string;
    signature: string;
    size: number;
  }>;
  provenance: { source: string; workflow?: string; commit?: string; builtAt?: string };
}

/** Un staging con un instalador de mentira. */
async function makeStaging(root: string, version = OFFERED): Promise<string> {
  const stage = join(root, "stage");
  const folder = join(stage, "linux", "x64", "deb");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `Tanit_${version}_amd64.deb`),
    "Tanit installer payload. Not a real installer: bytes with a digest.\n",
  );
  return stage;
}

/** Mide el staging con el script de la release. */
function prepare(stage: string, version: string): IResult {
  return run("bun", ["run", PREPARE, "--stage", stage, "--version", version]);
}

/** Construye y firma el manifest de actualización. */
function build(options: {
  readonly stage: string;
  readonly out: string;
  readonly key: string;
  readonly version: string;
  readonly minimumVersion: string;
  readonly baseUrl?: string;
}): IResult {
  const args = [
    "run",
    BUILD,
    "--stage",
    options.stage,
    "--out",
    options.out,
    "--key",
    options.key,
    "--version",
    options.version,
    "--minimum-version",
    options.minimumVersion,
  ];
  if (options.baseUrl !== undefined) {
    args.push("--base-url", options.baseUrl);
  }
  return run("bun", args);
}

/** Verifica el manifest con el verificador independiente. */
function verify(options: {
  readonly manifest: string;
  readonly signature: string;
  readonly publicKey: string;
  readonly platform?: string;
  readonly currentVersion?: string;
  readonly stage?: string;
  readonly smoke?: string;
  readonly smokeVersion?: string;
}): IResult {
  const args = [
    VERIFY,
    "--manifest",
    options.manifest,
    "--signature",
    options.signature,
    "--public-key",
    options.publicKey,
  ];
  if (options.platform !== undefined) {
    args.push("--platform", options.platform);
  }
  if (options.currentVersion !== undefined) {
    args.push("--current-version", options.currentVersion);
  }
  if (options.stage !== undefined) {
    args.push("--stage", options.stage);
  }
  if (options.smoke !== undefined) {
    args.push("--smoke", options.smoke);
  }
  if (options.smokeVersion !== undefined) {
    args.push("--smoke-version", options.smokeVersion);
  }
  return run("bash", args);
}

/** El estado de una actualización ya construida. */
interface IBuilt {
  readonly root: string;
  readonly out: string;
  readonly manifest: string;
  readonly signature: string;
  readonly stage: string;
  readonly key: IKey;
}

/** El ciclo completo: staging → manifest de release → manifest firmado. */
async function buildEverything(version = OFFERED): Promise<IBuilt> {
  const root = await tempDir("tanit-updater-");
  const stage = await makeStaging(root, version);
  const out = join(root, "out");
  const key = makeKey(root);

  const measured = prepare(stage, version);
  expect(measured.status, `the release manifest could not be measured: ${measured.output}`).toBe(0);

  const built = build({
    stage,
    out,
    key: key.private,
    version,
    minimumVersion: INSTALLED,
    baseUrl: `https://updates.tanit.dev/releases/${version}`,
  });
  expect(built.status, `the update manifest could not be built: ${built.output}`).toBe(0);

  return {
    root,
    out,
    manifest: join(out, UPDATE_MANIFEST_FILE),
    signature: join(out, UPDATE_SIGNATURE_FILE),
    stage,
    key,
  };
}

describe("el updater firmado", () => {
  test("el manifest tiene la forma que declara el contrato", async () => {
    const built = await buildEverything();
    try {
      const manifest = JSON.parse(await readFile(built.manifest, "utf8")) as IUpdateManifestJson;

      expect(manifest.schema).toBe(UPDATE_MANIFEST_SCHEMA);
      expect(manifest.version).toBe(OFFERED);
      expect(manifest.minimumSupportedVersion).toBe(INSTALLED);
      expect(manifest.publicKeyId).toBe(UPDATE_PUBLIC_KEY_ID);
      expect(manifest.signatureAlgorithm).toBe("ed25519");
      expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(manifest.provenance.source.length).toBeGreaterThan(0);

      expect(manifest.targets).toHaveLength(1);
      const target = manifest.targets[0];
      if (target === undefined) {
        throw new Error("the manifest has no target");
      }
      expect(target.os).toBe("linux");
      expect(target.arch).toBe("x64");
      expect(target.bundle).toBe("deb");
      expect(target.url.startsWith("https://")).toBe(true);
      expect(target.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(target.signature.length).toBeGreaterThan(0);
      expect(target.size).toBeGreaterThan(0);
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("un manifest firmado verifica", async () => {
    const built = await buildEverything();
    try {
      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
      });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("the update manifest is verified");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("una firma corrupta hace fallar al verificador", async () => {
    const built = await buildEverything();
    try {
      const signature = await readFile(built.signature, "utf8");
      await writeFile(built.signature, corruptSignature(signature), "utf8");

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.signature.invalid");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("una firma corrupta del instalador hace fallar al verificador", async () => {
    // La firma del manifest y la del instalador son **dos** firmas, y
    // el verificador las comprueba en **dos** ramas distintas: una
    // antes de mirar el artefacto y otra después. El test de la firma
    // corrupta del manifest no cubre la segunda, que es la que decide
    // si lo que se instala es exactamente lo que se firmó.
    //
    // Por eso el manifest se vuelve a firmar **después** de corromper
    // la firma del instalador: si no, el verificador abortaría antes,
    // en la firma del manifest, y la rama del instalador no se
    // probaría. Lo que se rompe es la firma que va **dentro** del
    // target, que es la que acredita los bytes del instalador.
    const built = await buildEverything();
    try {
      const manifest = JSON.parse(await readFile(built.manifest, "utf8")) as IUpdateManifestJson;
      const target = manifest.targets[0];
      if (target === undefined) {
        throw new Error("the manifest has no target");
      }
      target.signature = corruptSignature(target.signature);

      await writeFile(built.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(built.signature, `${sign(built.key.private, built.manifest)}\n`, "utf8");

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
      });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.signature.invalid");
      expect(result.output).toContain(
        "the artifact signature does not verify against the public key",
      );
      // Y es la rama del **instalador**: la firma del manifest
      // verifica y el digest del artefacto sigue cuadrando. Lo que no
      // verifica es la firma de los bytes que se van a instalar.
      expect(result.output).not.toContain("the manifest signature does not verify");
      expect(result.output).not.toContain("update.hash.mismatch");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("un hash corrupto hace fallar al verificador", async () => {
    const built = await buildEverything();
    try {
      const artifact = join(built.stage, "linux", "x64", "deb", `Tanit_${OFFERED}_amd64.deb`);
      // Mismo número de bytes, **otro** contenido. El tamaño sigue
      // cuadrando, así que el desajuste que se ve es el del digest y
      // no el del tamaño: son dos comprobaciones distintas y cada una
      // tiene su propio código de aborto.
      const original = await readFile(artifact, "utf8");
      await writeFile(artifact, original.replace("Tanit", "TUNIT"), "utf8");

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.hash.mismatch");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("un instalador truncado hace fallar al verificador con update.size.mismatch", async () => {
    // El verificador de consola comprueba el **tamaño antes** que el
    // digest, igual que el cliente nativo (`verify_artifact_hash`).
    // Por eso puede emitir `update.size.mismatch`: sin ese orden, el
    // código sería inalcanzable —cualquier cambio de tamaño cambia
    // también el digest— y las dos implementaciones no serían
    // equivalentes.
    const built = await buildEverything();
    try {
      const artifact = join(built.stage, "linux", "x64", "deb", `Tanit_${OFFERED}_amd64.deb`);
      const original = await readFile(artifact, "utf8");
      await writeFile(artifact, original.slice(0, original.length - 10), "utf8");

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.size.mismatch");
      // Y no es el desajuste del digest: el digest tampoco cuadra,
      // pero el tamaño es lo que se comprueba primero.
      expect(result.output).not.toContain("update.hash.mismatch");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("un target incorrecto hace fallar al verificador", async () => {
    const built = await buildEverything();
    try {
      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: "windows/x64/nsis",
        currentVersion: INSTALLED,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.target.unsupported");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("una versión anterior hace fallar al verificador", async () => {
    const built = await buildEverything("0.0.9");
    try {
      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.version.not_newer");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  test("un target en HTTP hace fallar al verificador", async () => {
    const root = await tempDir("tanit-updater-http-");
    try {
      const key = makeKey(root);
      const artifact = "Tanit installer payload.\n";
      const manifest = {
        schema: UPDATE_MANIFEST_SCHEMA,
        version: OFFERED,
        minimumSupportedVersion: INSTALLED,
        generatedAt: "2026-10-29T00:00:00.000Z",
        publicKeyId: UPDATE_PUBLIC_KEY_ID,
        signatureAlgorithm: "ed25519",
        targets: [
          {
            os: "linux",
            arch: "x64",
            bundle: "deb",
            url: `http://updates.tanit.dev/releases/${OFFERED}/${ARTIFACT_NAME}`,
            sha256: "0".repeat(64),
            signature: "AAAA",
            size: artifact.length,
          },
        ],
        provenance: { source: "release-desktop" },
      };
      const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
      const manifestPath = join(root, UPDATE_MANIFEST_FILE);
      const signaturePath = join(root, UPDATE_SIGNATURE_FILE);
      await writeFile(manifestPath, serialized, "utf8");
      await writeFile(signaturePath, `${sign(key.private, manifestPath)}\n`, "utf8");

      const result = verify({
        manifest: manifestPath,
        signature: signaturePath,
        publicKey: key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("update.endpoint.not_https");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("un manifest ausente hace fallar al verificador", async () => {
    const root = await tempDir("tanit-updater-missing-");
    try {
      const key = makeKey(root);
      const result = verify({
        manifest: join(root, "there-is-no-manifest.json"),
        signature: join(root, "there-is-no-signature.sig"),
        publicKey: key.public,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("the manifest is missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("el constructor se niega a firmar sin clave", async () => {
    const root = await tempDir("tanit-updater-nokey-");
    try {
      const stage = await makeStaging(root);
      const measured = prepare(stage, OFFERED);
      expect(measured.status, measured.output).toBe(0);

      const built = run("bun", [
        "run",
        BUILD,
        "--stage",
        stage,
        "--out",
        join(root, "out"),
        "--version",
        OFFERED,
      ]);
      expect(built.status).not.toBe(0);
      expect(built.output).toContain("No signing key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("el constructor no deja la clave privada en la salida", async () => {
    const root = await tempDir("tanit-updater-secret-");
    try {
      const stage = await makeStaging(root);
      const key = makeKey(root);
      const measured = prepare(stage, OFFERED);
      expect(measured.status, measured.output).toBe(0);

      const built = build({
        stage,
        out: join(root, "out"),
        key: key.private,
        version: OFFERED,
        minimumVersion: INSTALLED,
      });
      expect(built.status, built.output).toBe(0);

      // Ni la clave ni su contenido aparecen en lo que se imprime.
      const privatePem = await readFile(key.private, "utf8");
      expect(built.output).not.toContain(privatePem.trim());
      expect(built.output).not.toContain("PRIVATE KEY");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("un sidecar que no responde dice por qué y no muere en silencio", async () => {    // Un rechazo que no se puede leer no es un rechazo: parece un
    // fallo del verificador. Con `set -e`, un sidecar que no sabe
    // decir su versión se llevaba el verificador por delante con un
    // exit 1 sin una sola línea de explicación.
    const built = await buildEverything();
    try {
      const payload = join(built.root, "payload");
      await mkdir(join(payload, "binaries"), { recursive: true });
      await writeFile(
        join(payload, "binaries", "apisrc"),
        "#!/bin/sh\nexit 3\n",
        "utf8",
      );
      await chmod(join(payload, "binaries", "apisrc"), 0o755);

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
        smoke: payload,
        smokeVersion: OFFERED,
      });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("the sidecar could not report its version");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // El camino feliz, de punta a punta
  // -------------------------------------------------------------------------

  test("el smoke positivo del candidato pasa", async () => {
    // El camino que se había ejecutado a mano: manifest firmado, verificado
    // y **candidato** que arranca, escanea y exporta. Todo en local, sin red
    // y sin cuenta.
    const built = await buildEverything();
    try {
      const payload = join(built.root, "payload");
      await mkdir(join(payload, "binaries"), { recursive: true });
      // El sidecar que viaja dentro del instalador: dice la versión que se
      // está instalando y, para lo demás, es el del repo (así el smoke
      // exercise el binario de verdad y no una imitación).
      const sidecar = join(payload, "binaries", "apisrc");
      await writeFile(
        sidecar,
        [
          "#!/bin/sh",
          "# El sidecar del candidato: la versión que se está instalando,",
          "# y el sidecar del repo para todo lo demás.",
          'if [ "$1" = "--version" ]; then',
          `  echo "${OFFERED}"`,
          "  exit 0",
          "fi",
          `exec "${join(REPO_ROOT, "bin", "apisrc")}" "$@"`,
          "",
        ].join("\n"),
        "utf8",
      );
      await chmod(sidecar, 0o755);

      const result = verify({
        manifest: built.manifest,
        signature: built.signature,
        publicKey: built.key.public,
        platform: PLATFORM,
        currentVersion: INSTALLED,
        stage: built.stage,
        smoke: payload,
        smokeVersion: OFFERED,
      });

      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("the update manifest is verified");
      expect(result.output).toContain("the sidecar answered the handshake");
      expect(result.output).toContain("the sidecar scanned the project");
      expect(result.output).toContain("the sidecar exported the collection");
    } finally {
      await rm(built.root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // El doc y el código no pueden separarse
  // -------------------------------------------------------------------------

  test("el doc y el cliente dicen lo mismo sobre la rotación de claves", async () => {
    const doc = await readFile(join(REPO_ROOT, "docs", "UPDATER.md"), "utf8");
    const client = await readFile(
      join(REPO_ROOT, "packages", "desktop", "src", "updater.rs"),
      "utf8",
    );

    // Cuántas claves embebe el cliente. Hoy es una: el contrato tiene un
    // `publicKeyId` y un `publicKeyPem`, no una lista.
    const embedded = [...client.matchAll(/include_str!\("([^"]+\.pem)"\)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(embedded).toEqual(["../keys/tanit-updater-public-key-v1.pem"]);

    // Con una sola clave, el doc **no puede** prometer una rotación
    // compatible: el cliente aborta con `update.public_key.mismatch` en
    // cuanto el manifest declara otro identificador. El doc tiene que
    // decir la verdad sobre lo que el código hace.
    const plain = doc.replace(/\*/g, "");
    expect(plain.toLowerCase()).not.toContain("rotación compatible");
    expect(plain.toLowerCase()).toContain("rotación cortante");
    expect(doc).toContain("update.public_key.mismatch");
  });

  test("el desajuste de tamaño es un evento de seguridad en el contrato compartido", async () => {
    // La clasificación de un aborto no puede depender de lo que hizo el
    // atacante: si el desajuste de tamaño fuera "operativo", truncar el
    // instalador bajaría la alerta. Está decidido, está escrito y está
    // fijado por un test.
    expect(UPDATE_SECURITY_EVENT_CODES).toContain("update.size.mismatch");
    expect(UPDATE_SECURITY_EVENT_CODES).toContain("update.hash.mismatch");
    expect(UPDATE_SECURITY_EVENT_CODES).not.toContain("update.endpoint.unavailable");
    expect(UPDATE_SECURITY_EVENT_CODES).not.toContain("update.version.not_newer");
  });

  test("el manifest declara la versión mínima que dice el contrato", async () => {
    // Sin `--minimum-version`, el manifest toma la política del canal.
    // Si tomara la versión de la release, el canal dejaría fuera a
    // todos los clientes anteriores: nadie podría actualizarse.
    const root = await tempDir("tanit-updater-minimum-");
    try {
      const stage = await makeStaging(root);
      const key = makeKey(root);
      const measured = prepare(stage, OFFERED);
      expect(measured.status, measured.output).toBe(0);

      const built = run("bun", [
        "run",
        BUILD,
        "--stage",
        stage,
        "--out",
        join(root, "out"),
        "--key",
        key.private,
        "--version",
        OFFERED,
      ]);
      expect(built.status, built.output).toBe(0);

      const manifest = JSON.parse(
        await readFile(join(root, "out", UPDATE_MANIFEST_FILE), "utf8"),
      ) as IUpdateManifestJson;
      expect(manifest.minimumSupportedVersion).toBe(UPDATE_MINIMUM_SUPPORTED_VERSION);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // El pipeline: lo que la CI hace con el manifest
  // -------------------------------------------------------------------------

  test("el workflow de la release construye, verifica y adjunta el manifest firmado", async () => {
    const workflow = await workflowDocument();
    const publish = workflow.jobs.publish;
    expect(publish, "the workflow has no publish job").toBeDefined();

    const steps = publish?.steps ?? [];
    const runOf = (fragment: string): string => {
      const step = steps.find((candidate) => candidate.run?.includes(fragment));
      expect(step, `the workflow does not run \`${fragment}\``).toBeDefined();
      return step?.run ?? "";
    };

    // 1. La clave privada sale del secreto del CI y se materializa con
    //    permisos restringidos.
    expect(runOf("TANIT_UPDATER_KEY")).toContain("chmod 600");
    // 2. El manifest se construye y se firma.
    expect(runOf("build-update-manifest.mjs")).toContain("--key");
    // 3. Se verifica con el verificador independiente, con la clave
    //    pública que hay en el repo: si el secreto no es su
    //    contraparte, esto falla y no se publica nada.
    expect(runOf("verify-update.sh")).toContain("tanit-updater-public-key-v1.pem");
    // 4. Y el manifest y su firma se adjuntan a la release.
    expect(runOf("latest.json")).toContain("latest.json.sig");
  });

  test("el pipeline de la CI ejecuta los tests del crate de escritorio", async () => {
    const workflow = await workflowDocument(VALIDATE_WORKFLOW);
    const job = workflow.jobs["desktop-tests"];
    expect(job, "the CI has no desktop-tests job").toBeDefined();

    const runs = (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("cargo test");
    // Y el crate se puede compilar: hacen falta el frontend y el
    // sidecar, y si no están el build falla con un mensaje que no
    // habla de la causa real.
    expect(runs).toContain("build:app");
    expect(runs).toContain("packages/desktop/binaries/apisrc-");
  });
});
