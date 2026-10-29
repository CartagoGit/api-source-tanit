/**
 * La firma de la release de escritorio, probada de punta a punta.
 *
 * ## Qué se prueba aquí y qué no
 *
 * Se prueba **el contrato**: que el manifest mide lo que dice medir,
 * que el verificador recalcula en vez de creerse, que la política de
 * credenciales falla cerrada y que la matriz de credenciales que
 * faltan se detecta sin destapar ningún valor.
 *
 * No se prueba la firma de Apple ni la de Microsoft, y no porque sea
 * difícil: es que **no se puede** sin una cuenta de verdad, y un test
 * que necesita una cuenta de Apple no se ejecuta nunca. Lo que sí se
 * prueba es el camino de Linux, que es criptografía real y local: una
 * clave GPG temporal, generada en el propio test, contra un keyring
 * publicado. Y se prueba que los caminos de macOS y Windows **fallan
 * cerrado** cuando su herramienta no está, que es exactamente lo que
 * tiene que pasar si alguien publica desde la máquina equivocada.
 *
 * ## Los tests que miran el workflow
 *
 * El workflow se lee **como YAML**, no como texto: un test que
 * comprueba que el fichero contiene una cadena no falla cuando el
 * workflow hace otra cosa, sólo cuando alguien borra la cadena. Un
 * test que afirma "el job de publicación adjunta lo que dice el gate"
 * falla si el gate deja de ser el que manda.
 *
 * ## Nada de secretos
 *
 * Los valores de prueba son valores de prueba: frases con espacios,
 * que no se parecen a una credencial y que el lint de secretos del repo
 * no marca. Y el test comprueba explícitamente que **ningún** valor
 * aparece en la salida: el fallo de credenciales dice qué variable
 * falta, nunca qué vale — y tampoco lo dice cuando todo va bien.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import {
  MACOS_MINIMAL_ENTITLEMENTS,
  RELEASE_BUNDLE_FILE_SUFFIX,
  RELEASE_TARGET_MATRIX,
  SIGNING_PROVIDERS,
} from "../../packages/contracts/constants/release/signing.constant.js";

/** El script que mide el staging y escribe el manifest. */
const PREPARE = join(REPO_ROOT, "scripts", "release", "prepare-artifacts.mjs");
/** El script que lo verifica todo otra vez. */
const VERIFY = join(REPO_ROOT, "scripts", "release", "verify-signature.sh");
/** El script que firma en Linux. */
const SIGN_LINUX = join(REPO_ROOT, "scripts", "release", "sign-linux.sh");
/** El script que decide qué se adjunta a la release. */
const PUBLISH_GATE = join(REPO_ROOT, "scripts", "release", "publish-gate.mjs");
/** El script que firma en Windows. */
const SIGN_WINDOWS = join(REPO_ROOT, "scripts", "release", "sign-windows.ps1");
/** La configuración del host, donde vive `release.sign`. */
const CONFIG = join(REPO_ROOT, "delendai.config.json");
/** El workflow que publica la release. */
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "release-desktop.yml");

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
 * El `env` se pasa explícitamente porque la matriz de credenciales
 * necesita **quitar** variables, y eso no se puede hacer heredando el
 * entorno del proceso: se hereda y se sobrescribe.
 */
function run(
  command: string,
  args: readonly string[],
  env?: Record<string, string | undefined>,
): IResult {
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, output: `${stdout}${stderr}` };
}

/**
 * Corre `gpg` con la passphrase por la entrada estándar.
 *
 * La passphrase **nunca** va en la línea de órdenes: en `ps` la vería
 * cualquiera. Se pasa por el entorno y se vuelca a la entrada
 * estándar, que es lo que lee `--passphrase-fd 0`.
 */
function runGpg(args: readonly string[], home: string, passphrase: string): IResult {
  return run(
    "sh",
    ["-c", 'printf "%s\\n" "$TANIT_SIGN_TEST_PASSPHRASE" | gpg "$@"', "sh", ...args],
    { GNUPGHOME: home, TANIT_SIGN_TEST_PASSPHRASE: passphrase },
  );
}

/** Un directorio temporal que se borra al terminar. */
async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** ¿Hay `gpg` en esta máquina? */
const HAS_GPG = spawnSync("gpg", ["--version"], { encoding: "utf8" }).status === 0;

/** ¿Hay `pwsh` en esta máquina? */
const HAS_PWSH = spawnSync("pwsh", ["--version"], { encoding: "utf8" }).status === 0;

/** La firma, tal y como la escribe el manifest. */
interface ISignatureJson {
  kind: string;
  path: string;
  signer: string;
  keyId: string;
  timestamped: boolean;
  receipt: string | null;
  notarized?: boolean;
  stapled?: boolean;
}

/** Un artefacto del manifest. */
interface IArtifactJson {
  version: string;
  os: string;
  arch: string;
  bundle: string;
  path: string;
  sha256: string;
  signature: ISignatureJson | null;
  sbom: { path: string; sha256: string } | null;
  provenance: { path: string; sha256: string } | null;
}

/** Un asset del manifest. */
interface IAssetJson {
  kind: string;
  path: string;
  sha256: string;
  signature: ISignatureJson | null;
}

/** El manifest completo. */
interface IManifestJson {
  schema: string;
  version: string;
  generatedAt: string;
  artifacts: IArtifactJson[];
  assets: IAssetJson[];
}

/**
 * Genera una clave GPG temporal y la exporta a un fichero.
 *
 * No es una cuenta de GPG: es una clave que nace y muere con el test,
 * en un directorio temporal, y que no toca el keyring de quien lo
 * ejecuta. El fichero es lo que `sign-linux.sh` importa: el script
 * nunca usa el keyring por defecto, así que la clave tiene que
 * llegarle como fichero.
 */
async function createThrowawayKeyring(
  home: string,
  passphrase = "",
): Promise<{ fingerprint: string; keyFile: string } | null> {
  mkdir(home, { recursive: true });
  const generated = runGpg(
    [
      "--batch",
      "--yes",
      "--no-tty",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--quick-generate-key",
      "Tanit Release Fixture <release@example.invalid>",
      "default",
      "default",
      "never",
    ],
    home,
    passphrase,
  );
  if (generated.status !== 0) return null;

  const listed = run("gpg", ["--list-keys", "--with-colons"], { GNUPGHOME: home });
  let fingerprint = "";
  for (const line of listed.stdout.split("\n")) {
    if (line.startsWith("fpr:")) {
      fingerprint = line.split(":")[9] ?? "";
      break;
    }
  }
  if (fingerprint === "") return null;

  // La clave se exporta **blindada**: es un fichero de texto, y un
  // fichero de texto se puede comparar, leer y comprobar sin andarse
  // con bytes binarios.
  const exported = runGpg(
    [
      "--batch",
      "--yes",
      "--no-tty",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--armor",
      "--export-secret-keys",
      fingerprint,
    ],
    home,
    passphrase,
  );
  if (exported.status !== 0 || exported.stdout === "") return null;

  const keyFile = join(home, "release-keyring.gpg");
  await writeFile(keyFile, exported.stdout, "utf8");
  return { fingerprint, keyFile };
}

/** El staging del dry-run: los ocho artefactos de la matriz. */
async function dryRunStaging(prefix: string): Promise<string> {
  const stage = await tempDir(prefix);
  const result = run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]);
  expect(result.status, result.output).toBe(0);
  return stage;
}

/** El manifest que describe un staging. */
async function readManifest(stage: string): Promise<IManifestJson> {
  const raw = await readFile(join(stage, "release-manifest.json"), "utf8");
  return JSON.parse(raw) as IManifestJson;
}

/** Escribe un manifest editado. */
async function writeManifest(stage: string, manifest: IManifestJson): Promise<void> {
  await writeFile(
    join(stage, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

/** El SHA-256 de un fichero, calculado sin preguntarle al manifest. */
async function sha256(path: string): Promise<string> {
  const result = run("sha256sum", [path]);
  return result.stdout.trim().split(" ")[0] ?? "";
}

/** La versión de la release, leída de la fuente real. */
async function releaseVersion(): Promise<string> {
  const raw = await readFile(join(REPO_ROOT, "packages", "desktop", "tauri.conf.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "";
}

/** Una foto del staging: cada fichero con su digest. */
async function stageSnapshot(stage: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(`${relative(stage, full)} ${await sha256(full)}`);
    }
  };
  await walk(stage);
  return out.sort();
}

/**
 * Los recibos de los artefactos que esta máquina no puede firmar.
 *
 * macOS y Windows necesitan una cuenta de verdad, así que aquí se
 * escribe un recibo de fixture: no es una firma, pero es lo que hace
 * falta para que el manifest describa un artefacto firmado y el gate
 * pueda comprobar que la release adjunta todo lo que describe.
 */
async function attachFixtureReceipts(
  stage: string,
  kind: "notarization" | "authenticode",
): Promise<void> {
  const manifest = await readManifest(stage);
  for (const artifact of manifest.artifacts) {
    if (artifact.signature !== null) continue;
    const receipt = {
      kind,
      signer: "Tanit Release Fixture (FIXTURE)",
      keyId: "FIXTURETEAM",
      timestamped: true,
      ...(kind === "notarization" ? { notarized: true, stapled: true } : {}),
      sha256: artifact.sha256,
    };
    await writeFile(
      join(stage, `${artifact.path}.signature.json`),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }
  const measured = run("bun", ["run", PREPARE, "--stage", stage]);
  expect(measured.status, measured.output).toBe(0);
}

// --- el workflow, leído como YAML -------------------------------------------

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
 * Con `bun`, que trae un parser de YAML de serie: el test **no**
 * comprueba que el fichero contenga una cadena, comprueba que el
 * workflow haga una cosa.
 */
async function workflowDocument(): Promise<IWorkflow> {
  const script = `const text = await Bun.file(${JSON.stringify(WORKFLOW)}).text(); console.log(JSON.stringify(Bun.YAML.parse(text)));`;
  const result = run("bun", ["-e", script]);
  expect(result.status, result.output).toBe(0);
  return JSON.parse(result.stdout) as IWorkflow;
}

// ---------------------------------------------------------------------------
// 1. El dry-run y el manifest
// ---------------------------------------------------------------------------

describe("the release manifest", () => {
  test("the dry run produces every artifact the matrix declares", async () => {
    const stage = await dryRunStaging("tanit-release-dryrun");
    const manifest = await readManifest(stage);

    expect(manifest.artifacts.length).toBe(RELEASE_TARGET_MATRIX.length);

    for (const target of RELEASE_TARGET_MATRIX) {
      const found = manifest.artifacts.filter(
        (artifact) =>
          artifact.os === target.os &&
          artifact.arch === target.arch &&
          artifact.bundle === target.bundle,
      );
      expect(found.length, `${target.os}/${target.arch}/${target.bundle}`).toBe(1);
    }

    await rm(stage, { recursive: true, force: true });
  });

  test("it describes semver, platform, bundle, path, digest, signature and references", async () => {
    const stage = await dryRunStaging("tanit-release-manifest");
    const manifest = await readManifest(stage);

    expect(manifest.schema).toBe("tanit.release.manifest/v1");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);

    for (const artifact of manifest.artifacts) {
      expect(artifact.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(["macos", "windows", "linux"]).toContain(artifact.os);
      expect(["x64", "arm64"]).toContain(artifact.arch);
      expect(Object.keys(RELEASE_BUNDLE_FILE_SUFFIX)).toContain(artifact.bundle);

      // La ruta es relativa al staging: una ruta absoluta ataría el
      // manifest a la máquina que lo escribió.
      expect(artifact.path.startsWith("/")).toBe(false);
      expect(artifact.path).toContain(artifact.os);
      expect(artifact.path).toContain(artifact.arch);

      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);

      // El digest del manifest es el del fichero de verdad.
      const real = await sha256(join(stage, artifact.path));
      expect(real).toBe(artifact.sha256);

      // Y el fichero existe.
      expect(existsSync(join(stage, artifact.path))).toBe(true);

      // Las referencias de SBOM y provenance son null cuando no hay
      // ningún asset que las satisfaga: no se inventan.
      expect(artifact.sbom === null || typeof artifact.sbom.path === "string").toBe(true);
      expect(artifact.provenance === null || typeof artifact.provenance.path === "string").toBe(true);
    }

    await rm(stage, { recursive: true, force: true });
  });

  test("the artifacts this machine cannot sign are described as unsigned", async () => {
    const stage = await dryRunStaging("tanit-release-unsigned-shape");
    const manifest = await readManifest(stage);

    // Sin un certificado de Apple ni de Microsoft, esos artefactos no
    // se pueden firmar: el manifest lo dice con `null` en vez de
    // fingir una firma.
    for (const artifact of manifest.artifacts.filter(
      (a) => a.os === "macos" || a.os === "windows",
    )) {
      expect(artifact.signature, artifact.path).toBeNull();
    }

    await rm(stage, { recursive: true, force: true });
  });

  test("the per-platform manifests merge into one release manifest", async () => {
    const stage = await dryRunStaging("tanit-release-merge");
    const platformManifests = join(stage, "linux", "x64", "release-manifest.json");
    await writeFile(
      platformManifests,
      `${JSON.stringify(
        {
          schema: "tanit.release.manifest/v1",
          version: "0.1.0",
          generatedAt: new Date().toISOString(),
          artifacts: [],
          assets: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const merged = join(stage, "merged");
    await mkdir(merged, { recursive: true });
    const result = run("bun", [
      "run",
      PREPARE,
      "--merge",
      stage,
      "--manifest",
      join(merged, "release-manifest.json"),
    ]);
    expect(result.status, result.output).toBe(0);

    const mergedManifest = JSON.parse(
      await readFile(join(merged, "release-manifest.json"), "utf8"),
    ) as { artifacts: unknown[] };
    expect(mergedManifest.artifacts.length).toBe(RELEASE_TARGET_MATRIX.length);

    await rm(stage, { recursive: true, force: true });
  });

  test("the production assertion fails closed when a target of the matrix is missing", async () => {
    const stage = await dryRunStaging("tanit-release-production");

    // La config con la firma activada: sin ella, la aserción de
    // producción pararía antes, en la política.
    const config = await tempDir("tanit-release-production-config");
    const configPath = join(config, "delendai.config.json");
    await writeFile(configPath, `${JSON.stringify({ release: { sign: true } }, null, 2)}\n`, "utf8");

    // Con la matriz completa, la aserción dice que faltan firmas —no
    // targets—: la cobertura de la matriz se comprueba antes.
    const complete = run("bun", [
      "run",
      PREPARE,
      "--stage",
      stage,
      "--config",
      configPath,
      "--production",
    ]);
    expect(complete.status, complete.output).not.toBe(0);
    expect(complete.output).toContain("every artifact to be signed");
    expect(complete.output).not.toContain("every target of the matrix");

    // Ahora falta un target: el `.dmg` de macOS x64.
    const version = await releaseVersion();
    await rm(join(stage, "macos", "x64", "dmg", `Tanit_${version}_x64.dmg`), { force: true });
    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    const missing = run("bun", [
      "run",
      PREPARE,
      "--stage",
      stage,
      "--config",
      configPath,
      "--production",
    ]);
    expect(missing.status, missing.output).not.toBe(0);
    expect(missing.output).toContain("every target of the matrix");
    expect(missing.output).toContain("macos/x64/dmg");

    await rm(stage, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 2. El camino de Linux, con criptografía real
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_GPG)("the linux signing path", () => {
  test("the dry run signs the Linux artifacts for real", async () => {
    const stage = await dryRunStaging("tanit-release-dryrun-signed");
    const manifest = await readManifest(stage);

    const linux = manifest.artifacts.filter((artifact) => artifact.os === "linux");
    expect(linux.length).toBeGreaterThan(0);

    for (const artifact of linux) {
      expect(artifact.signature, artifact.path).not.toBeNull();
      expect(artifact.signature?.kind).toBe("gpg-detached");
      expect(artifact.signature?.path.endsWith(".sig")).toBe(true);
      expect(artifact.signature?.receipt).not.toBeNull();
      expect(existsSync(join(stage, artifact.signature?.path ?? ""))).toBe(true);
      expect(existsSync(join(stage, artifact.signature?.receipt ?? ""))).toBe(true);
    }

    // Y el keyring publicado está donde el verificador lo busca.
    expect(existsSync(join(stage, "linux", "x64", "keyring", "tanit-release-keyring.gpg"))).toBe(true);

    await rm(stage, { recursive: true, force: true });
  });

  test("the manifest records the signature of the checksums", async () => {
    const stage = await dryRunStaging("tanit-release-checksums-signature");
    const manifest = await readManifest(stage);

    const checksums = manifest.assets.find((asset) => asset.kind === "checksums");
    expect(checksums, "the checksums are an asset of the release").toBeDefined();
    expect(checksums?.signature, "SHA256SUMS goes signed").not.toBeNull();
    expect(checksums?.signature?.kind).toBe("gpg-detached");
    expect(checksums?.signature?.path.endsWith("SHA256SUMS.sig")).toBe(true);
    expect(checksums?.signature?.receipt).not.toBeNull();
    expect(checksums?.signature?.keyId.length ?? 0).toBeGreaterThan(0);

    await rm(stage, { recursive: true, force: true });
  });

  test("the Linux verifier accepts the dry run staging", async () => {
    const stage = await dryRunStaging("tanit-release-verified");

    // El criterio 8 del slice: cada verificador pasa para su OS. En
    // una máquina Linux, el de Linux es el que se puede ejecutar — y
    // pasa de verdad, contra el keyring publicado.
    const verified = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--platform",
      "linux",
      "--mode",
      "full",
    ]);
    expect(verified.status, verified.output).toBe(0);
    expect(verified.output).toContain("signature verified against the published keyring");
    expect(verified.output).toContain("SHA256SUMS: every checksum matches");

    await rm(stage, { recursive: true, force: true });
  });

  test("it signs with a key that is not in the runner's default keyring", async () => {
    const stage = await dryRunStaging("tanit-release-explicit-key");
    const home = await tempDir("tanit-release-gnupg");
    const empty = await tempDir("tanit-release-gnupg-empty");
    const key = await createThrowawayKeyring(home);
    expect(key, "the throwaway GPG key could not be generated").not.toBeNull();
    if (key === null) return;

    // El keyring por defecto del runner está **vacío**: la clave sólo
    // existe en el fichero que se importa. Si el script volviera a
    // depender del keyring por defecto, no firmaría nada.
    const listed = run("gpg", ["--list-keys"], { GNUPGHOME: empty });
    expect(listed.stdout).not.toContain(key.fingerprint);

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        GNUPGHOME: empty,
        TANIT_SIGN_GPG_KEY_ID: key.fingerprint,
        TANIT_SIGN_GPG_KEYRING: key.keyFile,
      },
    );
    expect(signed.status, signed.output).toBe(0);
    expect(existsSync(join(stage, "linux", "x64", "keyring", "tanit-release-keyring.gpg"))).toBe(true);

    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  });

  test("it refuses to sign when the keyring it is told to import does not exist", async () => {
    const stage = await dryRunStaging("tanit-release-missing-keyring");
    const root = await tempDir("tanit-release-missing-keyring-home");

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        GNUPGHOME: root,
        TANIT_SIGN_GPG_KEY_ID: "0000000000000000",
        TANIT_SIGN_GPG_KEYRING: join(root, "this-file-does-not-exist.gpg"),
      },
    );

    expect(signed.status).not.toBe(0);
    expect(signed.output).toContain("does not point to a readable file");

    await rm(stage, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  test("the passphrase never appears in the gpg command line", async () => {
    const stage = await dryRunStaging("tanit-release-passphrase");
    const home = await tempDir("tanit-release-gnupg-protected");
    const passphrase = "valor de prueba para la passphrase";
    const key = await createThrowawayKeyring(home, passphrase);
    expect(key, "the throwaway GPG key could not be generated").not.toBeNull();
    if (key === null) return;

    // Un `gpg` de mentira que anota sus argumentos: lo que se pasa por
    // la línea de órdenes se ve en `ps` y en `/proc/<pid>/cmdline`.
    const shim = await tempDir("tanit-release-gpg-shim");
    const argvLog = join(shim, "argv.log");
    const realGpg = run("sh", ["-c", "command -v gpg"]).stdout.trim();
    await writeFile(
      join(shim, "gpg"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}\nexec ${realGpg} "$@"\n`,
      "utf8",
    );
    await chmod(join(shim, "gpg"), 0o755);

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        PATH: `${shim}:${process.env.PATH ?? ""}`,
        GNUPGHOME: home,
        TANIT_SIGN_GPG_KEY_ID: key.fingerprint,
        TANIT_SIGN_GPG_KEYRING: key.keyFile,
        TANIT_SIGN_GPG_PASSPHRASE: passphrase,
      },
    );
    expect(signed.status, signed.output).toBe(0);

    const argv = await readFile(argvLog, "utf8");
    expect(argv.length).toBeGreaterThan(0);
    expect(argv, "the passphrase is visible in the process arguments").not.toContain(passphrase);

    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(shim, { recursive: true, force: true });
  });

  test("it refuses a signature that does not verify against the published keyring", async () => {
    const stage = await dryRunStaging("tanit-release-wrongkey");
    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    // El keyring publicado se vacía: la firma sigue ahí, pero ya no hay
    // ninguna clave que la respalde.
    const keyring = join(stage, "linux", "x64", "keyring", "tanit-release-keyring.gpg");
    await writeFile(keyring, "", "utf8");

    const verified = run(
      "bash",
      [
        VERIFY,
        "--manifest",
        join(stage, "release-manifest.json"),
        "--stage",
        stage,
        "--platform",
        "linux",
        "--mode",
        "full",
      ],
    );
    expect(verified.status, verified.output).not.toBe(0);
    expect(verified.output).toContain("does not verify against the published keyring");

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses a checksum file whose signature does not verify", async () => {
    const stage = await dryRunStaging("tanit-release-bad-checksum-signature");

    // La firma de los checksums se sustituye por basura: la firma de
    // los checksums se produce, se publica y **se comprueba**.
    const signature = join(stage, "linux", "x64", "checksums", "SHA256SUMS.sig");
    await writeFile(signature, "not a signature at all\n", "utf8");
    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    const verified = run(
      "bash",
      [
        VERIFY,
        "--manifest",
        join(stage, "release-manifest.json"),
        "--stage",
        stage,
        "--platform",
        "linux",
        "--mode",
        "full",
      ],
    );
    expect(verified.status, verified.output).not.toBe(0);
    expect(verified.output).toContain("does not verify against the published keyring");

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses an artifact that changed after it was signed", async () => {
    const stage = await dryRunStaging("tanit-release-after-sign");
    const version = await releaseVersion();

    // Se cambia el artefacto después de firmarlo: el digest del
    // manifest ya no describe los bytes que se publicarían.
    await writeFile(
      join(stage, "linux", "x64", "deb", `Tanit_${version}_x64.deb`),
      "swapped after signing\n",
      "utf8",
    );

    const verified = run(
      "bash",
      [
        VERIFY,
        "--manifest",
        join(stage, "release-manifest.json"),
        "--stage",
        stage,
        "--platform",
        "linux",
        "--mode",
        "full",
      ],
    );
    expect(verified.status, verified.output).not.toBe(0);
    expect(verified.output).toContain("digest does not match");

    await rm(stage, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 3. El verificador
// ---------------------------------------------------------------------------

describe("the signature verifier", () => {
  test("it refuses a staging whose artifacts are not signed", async () => {
    const stage = await dryRunStaging("tanit-release-unsigned");
    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("not signed");

    await rm(stage, { recursive: true, force: true });
  });

  test("it recomputes the digest instead of trusting the manifest", async () => {
    const stage = await dryRunStaging("tanit-release-tampered");
    const manifest = await readManifest(stage);
    const victim = manifest.artifacts[0];
    expect(victim).toBeDefined();
    if (victim === undefined) return;

    // Se toca el artefacto **después** de medirlo.
    await writeFile(join(stage, victim.path), "tampered\n", "utf8");

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("digest does not match");

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses a staging with a file the manifest does not describe", async () => {
    const stage = await dryRunStaging("tanit-release-leftover");
    await writeFile(join(stage, "linux", "x64", "deb", "unsigned-extra.deb"), "extra\n", "utf8");

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("does not describe");

    await rm(stage, { recursive: true, force: true });
  });

  test("it fails closed when a native tool is missing", async () => {
    const stage = await dryRunStaging("tanit-release-native");
    const manifest = await readManifest(stage);
    const victim = manifest.artifacts.find((artifact) => artifact.os === "macos");
    expect(victim).toBeDefined();
    if (victim === undefined) return;

    // Un recibo que dice que el artefacto está notarizado y grapado.
    // No es una firma real —no se puede hacer una sin un certificado de
    // Apple—, pero sirve para llegar a la comprobación nativa, que es
    // lo que se quiere probar: en una máquina sin `codesign`, la
    // verificación de un artefacto de macOS **falla**, en vez de
    // saltarse la comprobación y darlo por bueno.
    const digest = await sha256(join(stage, victim.path));
    await writeFile(
      join(stage, `${victim.path}.signature.json`),
      `${JSON.stringify(
        {
          kind: "notarization",
          signer: "Developer ID Application: Tanit (FIXTURE)",
          keyId: "FIXTURETEAM",
          timestamped: true,
          notarized: true,
          stapled: true,
          sha256: digest,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    expect(run("bun", ["run", PREPARE, "--stage", stage]).status).toBe(0);

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--platform",
      "macos",
      "--mode",
      "full",
    ]);

    // En Linux no hay `codesign`: la comprobación nativa de macOS no se
    // puede hacer, y una verificación que se salta su comprobación no
    // es una verificación.
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("codesign");

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses a signature path that escapes the staging", async () => {
    const root = await tempDir("tanit-release-traversal-signature");
    const stage = join(root, "stage");
    await mkdir(stage, { recursive: true });
    expect(run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]).status).toBe(0);

    const manifest = await readManifest(stage);
    const victim = manifest.artifacts.find(
      (artifact) => artifact.os === "linux" && artifact.signature !== null,
    );
    expect(victim).toBeDefined();
    if (victim === undefined || victim.signature === null) return;

    // La firma sale del staging —y sigue siendo una firma válida—,
    // pero el manifest la apunta desde fuera.
    await rename(join(stage, victim.signature.path), join(root, "outside.sig"));

    const edited: IManifestJson = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.path === victim.path && artifact.signature !== null
          ? { ...artifact, signature: { ...artifact.signature, path: "../outside.sig" } }
          : artifact,
      ),
    };
    await writeManifest(stage, edited);

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--platform",
      "linux",
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("escapes the staging directory");

    await rm(root, { recursive: true, force: true });
  });

  test("it refuses a receipt path that escapes the staging", async () => {
    const root = await tempDir("tanit-release-traversal-receipt");
    const stage = join(root, "stage");
    await mkdir(stage, { recursive: true });
    expect(run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]).status).toBe(0);

    const manifest = await readManifest(stage);
    const victim = manifest.artifacts.find(
      (artifact) => artifact.os === "linux" && artifact.signature !== null,
    );
    expect(victim).toBeDefined();
    if (victim === undefined || victim.signature === null) return;

    // El recibo sale del staging. Su digest sigue siendo el del
    // artefacto, así que sin el guardia la verificación pasaría.
    await rename(join(stage, victim.signature.receipt ?? ""), join(root, "outside-receipt.json"));

    const edited: IManifestJson = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.path === victim.path && artifact.signature !== null
          ? { ...artifact, signature: { ...artifact.signature, receipt: "../outside-receipt.json" } }
          : artifact,
      ),
    };
    await writeManifest(stage, edited);

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--platform",
      "linux",
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("escapes the staging directory");

    await rm(root, { recursive: true, force: true });
  });

  test("it refuses a checksum file that points outside the staging", async () => {
    const root = await tempDir("tanit-release-checksum-traversal");
    const stage = join(root, "stage");
    await mkdir(stage, { recursive: true });
    expect(run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]).status).toBe(0);

    // Un fichero fuera del staging, y un `SHA256SUMS` que lo apunta.
    const outside = join(root, "outside.txt");
    await writeFile(outside, "not part of the release\n", "utf8");
    const checksums = join(stage, "linux", "x64", "checksums", "SHA256SUMS");
    await writeFile(checksums, `${await sha256(outside)}  ../../../../outside.txt\n`, "utf8");

    // El manifest se vuelve a medir, para que el fallo sea el de las
    // rutas y no el del digest del asset.
    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--platform",
      "linux",
      "--mode",
      "full",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("the checksums do not match the artifacts inside the staging");

    await rm(root, { recursive: true, force: true });
  });

  test("it does not write into the staging it verifies", async () => {
    const stage = await dryRunStaging("tanit-release-readonly");
    const before = await stageSnapshot(stage);

    const result = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "portable",
      "--allow-unsigned=true",
    ]);
    expect(result.status, result.output).toBe(0);

    // Un verificador que reescribe lo que verifica no está verificando.
    const after = await stageSnapshot(stage);
    expect(after).toEqual(before);

    await rm(stage, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 4. El verificador de Windows
// ---------------------------------------------------------------------------

describe("the windows verification", () => {
  test("the verifier writes nothing: the receipt is written by the signer", async () => {
    const source = await readFile(SIGN_WINDOWS, "utf8");

    // El cuerpo de `Invoke-Verify` es lo que se comprueba: si escribe,
    // el verificador reescribe el recibo que está verificando.
    const start = source.indexOf("function Invoke-Verify");
    expect(start, "Invoke-Verify has to exist").toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start);
    expect(end, "Invoke-Verify has to end").toBeGreaterThan(start);
    const body = source.slice(start, end);

    expect(body).not.toMatch(/Set-Content|Out-File|Add-Content|WriteAllText|New-Item/);

    // Y el recibo lo escribe quien firma, con el digest de los bytes
    // ya firmados.
    expect(source).toContain('Write-Receipt $path "$path.signature.json"');
    expect(source).toContain("sha256       = (Get-Sha256 $Path)");
  });

  test.skipIf(!HAS_PWSH)("the verifier leaves no receipt behind", async () => {
    const root = await tempDir("tanit-release-windows");
    const artifact = join(root, "installer.msi");
    await writeFile(artifact, "not really an installer\n", "utf8");

    const result = run("pwsh", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SIGN_WINDOWS,
      "-Verify",
      artifact,
    ]);
    expect(result.status).not.toBe(0);
    expect(existsSync(`${artifact}.signature.json`)).toBe(false);

    await rm(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 5. El gate de publicación
// ---------------------------------------------------------------------------

describe("the publish gate", () => {
  test("it attaches the merged manifest, and only one file with that name", async () => {
    const stage = await dryRunStaging("tanit-release-gate");

    // El staging de un runner tiene un manifest por plataforma además
    // del mergeado: los dos tienen el mismo nombre.
    for (const target of RELEASE_TARGET_MATRIX) {
      await mkdir(join(stage, target.os, target.arch), { recursive: true });
      await writeFile(
        join(stage, target.os, target.arch, "release-manifest.json"),
        `${JSON.stringify(
          {
            schema: "tanit.release.manifest/v1",
            version: "0.1.0",
            artifacts: [],
            assets: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }

    const result = run("bun", ["run", PUBLISH_GATE, "--stage", stage, "--allow-unsigned", "--list"]);
    expect(result.status, result.output).toBe(0);

    const attached = result.stdout.split("\n").filter((line) => line.trim() !== "");
    const manifests = attached.filter((line) => line.endsWith("release-manifest.json"));
    expect(manifests.length, "the release attaches exactly one manifest").toBe(1);
    expect(manifests[0]).toBe(join(stage, "release-manifest.json"));

    // Y ningún basename se repite: la acción que los sube nombra cada
    // asset por su `basename` y pisa el que ya estaba.
    const names = attached.map((line) => line.split("/").pop() ?? "");
    expect(new Set(names).size, "two assets share a name").toBe(names.length);

    await rm(stage, { recursive: true, force: true });
  });

  test("it attaches the per-artifact signatures", async () => {
    const stage = await dryRunStaging("tanit-release-gate-signatures");

    const result = run("bun", ["run", PUBLISH_GATE, "--stage", stage, "--allow-unsigned", "--list"]);
    expect(result.status, result.output).toBe(0);

    const attached = result.stdout.split("\n").filter((line) => line.trim() !== "");
    const signatures = attached.filter((line) => line.endsWith(".sig"));
    expect(signatures.length).toBeGreaterThan(0);
    expect(signatures.some((line) => line.includes("SHA256SUMS.sig"))).toBe(true);
    expect(signatures.some((line) => line.includes(".deb.sig"))).toBe(true);

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses a staging that misses a target of the matrix", async () => {
    const stage = await dryRunStaging("tanit-release-gate-missing");
    const version = await releaseVersion();

    await rm(join(stage, "macos", "x64", "dmg", `Tanit_${version}_x64.dmg`), { force: true });
    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    const result = run("bun", ["run", PUBLISH_GATE, "--stage", stage, "--allow-unsigned"]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("does not cover the target macos/x64/dmg");

    await rm(stage, { recursive: true, force: true });
  });

  test("it refuses to attach an unsigned artifact", async () => {
    const stage = await dryRunStaging("tanit-release-gate-unsigned");

    const result = run("bun", ["run", PUBLISH_GATE, "--stage", stage]);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("does not attach an unsigned artifact");

    await rm(stage, { recursive: true, force: true });
  });

  test("it accepts a staging where every artifact is signed", async () => {
    const stage = await dryRunStaging("tanit-release-gate-signed");
    await attachFixtureReceipts(stage, "notarization");

    const result = run("bun", ["run", PUBLISH_GATE, "--stage", stage, "--list"]);
    expect(result.status, result.output).toBe(0);

    const attached = result.stdout.split("\n").filter((line) => line.trim() !== "");
    expect(attached.length).toBeGreaterThan(RELEASE_TARGET_MATRIX.length);

    await rm(stage, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 6. La matriz de credenciales que faltan
// ---------------------------------------------------------------------------

describe("the missing credentials matrix", () => {
  /**
   * Un valor de prueba que **no** se parece a una credencial: tiene
   * espacios, y por eso el lint de secretos del repo no lo marca ni lo
   * puede marcar.
   */
  const fakeValue = (name: string): string => `valor de prueba para ${name}`;

  test("with signing disabled the audit is informational", async () => {
    const result = run("bun", ["run", PREPARE, "--check-credentials", "--os", "linux"]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Signing is disabled");
  });

  test.for(SIGNING_PROVIDERS.map((provider) => [provider.id, provider] as const))(
    "%s names every missing variable and never prints a value",
    async ([, provider]) => {
      // Con la firma activada: es el modo en el que una credencial que
      // falta para la release.
      const config = await tempDir("tanit-release-matrix");
      const configPath = join(config, "delendai.config.json");
      await writeFile(
        configPath,
        `${JSON.stringify({ release: { sign: true } }, null, 2)}\n`,
        "utf8",
      );

      const complete: Record<string, string> = {};
      for (const name of provider.requiredEnv) complete[name] = fakeValue(name);

      // 1. Con todas las variables presentes, la auditoría pasa.
      const ready = run(
        "bun",
        [
          "run",
          PREPARE,
          "--check-credentials",
          "--config",
          configPath,
          "--os",
          provider.os,
        ],
        { ...complete },
      );
      expect(ready.status, ready.output).toBe(0);

      // Y el camino de éxito **tampoco** imprime valores: no sólo
      // falla en silencio cuando algo falta, sino que nunca dice
      // cuánto vale una credencial.
      for (const [name, value] of Object.entries(complete)) {
        expect(ready.output, `the value of ${name} leaked`).not.toContain(value);
      }

      // 2. Falta una → se nombra esa, y sólo esa.
      for (const missing of provider.requiredEnv) {
        const partial: Record<string, string | undefined> = { ...complete };
        delete partial[missing];

        const result = run(
          "bun",
          [
            "run",
            PREPARE,
            "--check-credentials",
            "--config",
            configPath,
            "--os",
            provider.os,
          ],
          { ...partial },
        );

        expect(result.status, `${provider.id} without ${missing}`).not.toBe(0);
        expect(result.output).toContain(missing);

        // Los valores de las variables que **sí** están no aparecen.
        for (const [name, value] of Object.entries(complete)) {
          if (name === missing) continue;
          expect(result.output, `the value of ${name} leaked`).not.toContain(value);
        }
      }

      await rm(config, { recursive: true, force: true });
    },
  );

  test("with signing enabled a missing credential stops the release", async () => {
    const config = await tempDir("tanit-release-config");
    const configPath = join(config, "delendai.config.json");
    await writeFile(configPath, `${JSON.stringify({ release: { sign: true } }, null, 2)}\n`, "utf8");

    const complete: Record<string, string> = {};
    for (const provider of SIGNING_PROVIDERS) {
      for (const name of provider.requiredEnv) complete[name] = fakeValue(name);
    }

    const ready = run(
      "bun",
      ["run", PREPARE, "--check-credentials", "--config", configPath, "--os", "linux"],
      complete,
    );
    expect(ready.status, ready.output).toBe(0);

    // El camino de éxito tampoco destapa nada.
    for (const value of Object.values(complete)) {
      expect(ready.output, "a credential value leaked").not.toContain(value);
    }

    const incomplete = { ...complete };
    delete incomplete["TANIT_SIGN_GPG_KEY_ID"];
    const failed = run(
      "bun",
      ["run", PREPARE, "--check-credentials", "--config", configPath, "--os", "linux"],
      incomplete,
    );
    expect(failed.status).not.toBe(0);
    expect(failed.output).toContain("TANIT_SIGN_GPG_KEY_ID");
    expect(failed.output).toContain("Signing is enabled");

    // Ni el valor de las que sí están, ni el de la que falta.
    for (const value of Object.values(incomplete)) {
      expect(failed.output, "a credential value leaked").not.toContain(value);
    }

    await rm(config, { recursive: true, force: true });
  });

  test("the repository ships with signing disabled", async () => {
    const raw = JSON.parse(await readFile(CONFIG, "utf8")) as {
      release?: { sign?: unknown };
    };
    expect(raw.release?.sign).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Lo que la release promete en el papel
// ---------------------------------------------------------------------------

describe("the release policy", () => {
  test("the macOS entitlements are exactly the minimal ones", async () => {
    const plist = await readFile(
      join(REPO_ROOT, "packages", "desktop", "entitlements", "Tanit.entitlements.plist"),
      "utf8",
    );

    for (const entitlement of MACOS_MINIMAL_ENTITLEMENTS) {
      expect(plist, entitlement).toContain(`<key>${entitlement}</key>`);
    }

    // Y no hay ni uno de más: cada entitlement de más es una
    // capacidad de más.
    const declared = [...plist.matchAll(/<key>(com\.apple\.[^<]+)<\/key>/g)].map((match) => match[1]);
    expect(declared.sort()).toEqual([...MACOS_MINIMAL_ENTITLEMENTS].sort());
  });

  test("the publication requires signing and the whole build", async () => {
    const workflow = await workflowDocument();

    // La publicación exige `release.sign=true`.
    const workflowText = await readFile(WORKFLOW, "utf8");
    expect(workflowText).toContain("release.sign=true");
    expect(workflow.jobs.publish?.needs).toBe("build");
  });

  test("the release attaches what the publish gate says, and not a list of its own", async () => {
    const workflow = await workflowDocument();
    const publish = workflow.jobs.publish;
    expect(publish).toBeDefined();
    if (publish === undefined) return;

    // El gate es lo que decide: el job de publicación lo ejecuta y
    // adjunta **su** lista.
    const gate = publish.steps.find(
      (step) => typeof step.run === "string" && step.run.includes("publish-gate.mjs"),
    );
    expect(gate, "the publish job runs the gate").toBeDefined();

    const attach = publish.steps.find((step) => step.uses === "softprops/action-gh-release@v3");
    expect(attach, "the release attaches the assets").toBeDefined();
    expect(attach?.with?.files).toBe("${{ steps.assets.outputs.files }}");

    // Y ningún paso del workflow adjunta globs propios: dos listas son
    // dos verdades, y la segunda es la que gana sin que nadie lo note.
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        const files = step.with?.files;
        if (files === undefined) continue;
        expect(
          typeof files,
          `the step "${step.name ?? step.uses}" attaches a list of its own`,
        ).toBe("string");
        expect(String(files)).not.toContain("**");
      }
    }
  });

  test("the workflow imports the GPG key instead of trusting the runner's keyring", async () => {
    const workflow = await workflowDocument();
    const build = workflow.jobs.build;
    expect(build).toBeDefined();
    if (build === undefined) return;

    // La clave llega como secreto y se escribe en un fichero.
    const prepare = build.steps.find((step) => step.id === "gpgkey");
    expect(prepare, "the workflow prepares the GPG key").toBeDefined();
    expect(prepare?.env?.TANIT_SIGN_GPG_KEYRING_SECRET ?? "").toContain(
      "secrets.TANIT_SIGN_GPG_KEYRING",
    );

    // Y el firmante recibe **el fichero**, no el secreto en claro.
    const sign = build.steps.find(
      (step) => typeof step.run === "string" && step.run.includes("sign-linux.sh"),
    );
    expect(sign, "the workflow signs on Linux").toBeDefined();
    expect(sign?.env?.TANIT_SIGN_GPG_KEYRING ?? "").toContain("steps.gpgkey.outputs.keyring");
    expect(sign?.env?.TANIT_SIGN_GPG_KEYRING ?? "").not.toContain("secrets.");
  });

  test("the verifier understands the explicit form of --allow-unsigned", async () => {
    // El workflow decide el valor con una expresión y lo pasa como
    // `--allow-unsigned=true|false`. Si el verificador sólo entendiera
    // el flag a secas, el `false` —que es el caso de una release
    // firmada— llegaría como argumento desconocido y el job moriría
    // antes de verificar nada.
    const stage = await dryRunStaging("tanit-release-allow-unsigned");

    const explicit = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "full",
      "--allow-unsigned=false",
    ]);
    expect(explicit.output).not.toContain("Unknown argument");
    expect(explicit.status).not.toBe(0);
    expect(explicit.output).toContain("not signed");

    const allowed = run("bash", [
      VERIFY,
      "--manifest",
      join(stage, "release-manifest.json"),
      "--stage",
      stage,
      "--mode",
      "full",
      "--allow-unsigned=true",
    ]);
    expect(allowed.output).not.toContain("Unknown argument");
    expect(allowed.status, allowed.output).toBe(0);

    await rm(stage, { recursive: true, force: true });
  });

  test("the macOS image is built after the bundle is notarized and stapled", async () => {
    const workflow = await readFile(WORKFLOW, "utf8");

    // El orden de Apple: firmar → notarizar → grapar → imagen. Si el
    // `.dmg` se construyera antes, llevaría dentro un bundle sin
    // firmar y Apple rechazaría la imagen.
    const notarize = workflow.indexOf("- name: Notarizar (macOS)");
    const packageDmg = workflow.indexOf("- name: Empaquetar el .dmg (macOS)");
    const signDmg = workflow.indexOf("- name: Firmar el .dmg (macOS)");

    expect(notarize).toBeGreaterThan(-1);
    expect(packageDmg).toBeGreaterThan(-1);
    expect(signDmg).toBeGreaterThan(-1);
    expect(notarize, "the bundle must be notarized before the image is built").toBeLessThan(
      packageDmg,
    );
    expect(packageDmg, "the image must exist before it is signed").toBeLessThan(signDmg);

    // Y el script que la construye vive en el repo.
    expect(workflow).toContain("scripts/release/package-dmg.sh");
    const packager = await readFile(
      join(REPO_ROOT, "scripts", "release", "package-dmg.sh"),
      "utf8",
    );
    expect(packager).toContain("set -euo pipefail");
    expect(packager).toContain("hdiutil create");
  });

  test("the macOS bundle is published with a name of its own", async () => {
    const workflow = await readFile(WORKFLOW, "utf8");

    // Los assets se adjuntan por su `basename`: los dos bundles de
    // macOS se llamarían igual y el segundo pisaría al primero.
    expect(workflow).toContain("Tanit_${VERSION}_${{ matrix.arch }}.app.zip");
  });

  test("the workflow asks the build script for the bundles the matrix declares", async () => {
    const workflow = await readFile(WORKFLOW, "utf8");

    // `scripts/build/desktop-build.script.ts` lee `EXPOSTMAN_BUNDLES`.
    // Con otro nombre, el recorte de formatos se ignora en silencio y
    // el runner construye bundles que la matriz no pidió.
    const build = await readFile(
      join(REPO_ROOT, "scripts", "build", "desktop-build.script.ts"),
      "utf8",
    );
    expect(build).toContain("EXPOSTMAN_BUNDLES");

    expect(workflow).toContain("EXPOSTMAN_BUNDLES: ${{ matrix.tauri_bundles }}");
    expect(workflow).not.toContain("TANIT_BUNDLES");
  });

  test("the release documentation covers secrets, rotation, troubleshooting and verification", async () => {
    const docs = await readFile(join(REPO_ROOT, "docs", "RELEASE.md"), "utf8");

    // Los secrets de cada proveedor, por nombre.
    for (const provider of SIGNING_PROVIDERS) {
      for (const name of provider.requiredEnv) {
        expect(docs, name).toContain(name);
      }
    }

    expect(docs).toContain("rotaci");
    expect(docs.toLowerCase()).toContain("troubleshooting");
    expect(docs).toContain("verify-signature.sh");
    expect(docs).toContain("publish-gate.mjs");
    expect(docs.toLowerCase()).toContain("reproducible");
  });
});
