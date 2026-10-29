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
 * ## Nada de secretos
 *
 * Los valores de prueba son valores de prueba: frases con espacios,
 * que no se parecen a una credencial y que el lint de secretos del
 * repo no marca. Y el test comprueba explícitamente que **ningún**
 * valor aparece en la salida: el fallo de credenciales dice qué
 * variable falta, nunca qué vale.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
/** La configuración del host, donde vive `release.sign`. */
const CONFIG = join(REPO_ROOT, "delendai.config.json");

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

/** Un directorio temporal que se borra al terminar. */
async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

/** ¿Hay `gpg` en esta máquina? */
const HAS_GPG = spawnSync("gpg", ["--version"], { encoding: "utf8" }).status === 0;

/**
 * Genera una clave GPG temporal, en un keyring propio.
 *
 * No es una cuenta de GPG: es una clave que nace y muere con el test,
 * en un directorio temporal, y que no toca el keyring de quien lo
 * ejecuta.
 */
function createThrowawayKey(home: string): string | null {
  mkdir(home, { recursive: true });
  const generated = run(
    "gpg",
    [
      "--batch",
      "--passphrase",
      "",
      "--quick-generate-key",
      "Tanit Release Fixture <release@example.invalid>",
      "default",
      "default",
      "never",
    ],
    { GNUPGHOME: home },
  );
  if (generated.status !== 0) return null;
  const listed = run("gpg", ["--list-keys", "--with-colons"], { GNUPGHOME: home });
  for (const line of listed.stdout.split("\n")) {
    if (line.startsWith("fpr:")) {
      const fingerprint = line.split(":")[9];
      if (fingerprint !== undefined && fingerprint !== "") return fingerprint;
    }
  }
  return null;
}

/** El staging del dry-run: los ocho artefactos de la matriz. */
async function dryRunStaging(prefix: string): Promise<string> {
  const stage = await tempDir(prefix);
  const result = run("bun", ["run", PREPARE, "--dry-run", "--stage", stage]);
  expect(result.status, result.output).toBe(0);
  return stage;
}

/** El manifest que describe un staging. */
async function readManifest(stage: string): Promise<{
  schema: string;
  version: string;
  artifacts: Array<{
    version: string;
    os: string;
    arch: string;
    bundle: string;
    path: string;
    sha256: string;
    signature: {
      kind: string;
      path: string;
      signer: string;
      keyId: string;
      timestamped: boolean;
      receipt: string | null;
    } | null;
    sbom: { path: string; sha256: string } | null;
    provenance: { path: string; sha256: string } | null;
  }>;
  assets: Array<{ kind: string; path: string; sha256: string }>;
}> {
  const raw = await readFile(join(stage, "release-manifest.json"), "utf8");
  return JSON.parse(raw);
}

/** El SHA-256 de un fichero, calculado sin perguntarle al manifest. */
async function sha256(path: string): Promise<string> {
  const result = run("sha256sum", [path]);
  return result.stdout.trim().split(" ")[0] ?? "";
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

  test("the signature carries the signer and the key id when there is one", async () => {
    const stage = await dryRunStaging("tanit-release-signature");
    const manifest = await readManifest(stage);

    // Sin credenciales, ningún artefacto está firmado — y el manifest
    // lo dice con `null` en vez de fingir una firma.
    for (const artifact of manifest.artifacts) {
      expect(artifact.signature).toBeNull();
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
});

// ---------------------------------------------------------------------------
// 2. El verificador
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
});

// ---------------------------------------------------------------------------
// 3. El camino de Linux, con criptografía real
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_GPG)("the linux signing path", () => {
  test("it signs, publishes a keyring and verifies against it", async () => {
    const stage = await dryRunStaging("tanit-release-linux");
    const home = await tempDir("tanit-release-gnupg");
    const keyId = createThrowawayKey(home);
    expect(keyId, "the throwaway GPG key could not be generated").not.toBeNull();
    if (keyId === null) return;

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        GNUPGHOME: home,
        TANIT_SIGN_GPG_KEY_ID: keyId,
        TANIT_SIGN_GPG_KEYRING: "tanit-release-keyring.gpg",
      },
    );
    expect(signed.status, signed.output).toBe(0);

    // Los checksums, su firma, el keyring publicado y una firma por
    // artefacto.
    expect(existsSync(join(stage, "linux", "x64", "checksums", "SHA256SUMS"))).toBe(true);
    expect(existsSync(join(stage, "linux", "x64", "checksums", "SHA256SUMS.sig"))).toBe(true);
    expect(
      existsSync(join(stage, "linux", "x64", "keyring", "tanit-release-keyring.gpg")),
    ).toBe(true);

    const measured = run("bun", ["run", PREPARE, "--stage", stage]);
    expect(measured.status, measured.output).toBe(0);

    const manifest = await readManifest(stage);
    for (const artifact of manifest.artifacts.filter((a) => a.os === "linux")) {
      expect(artifact.signature, artifact.path).not.toBeNull();
      expect(artifact.signature?.kind).toBe("gpg-detached");
      expect(artifact.signature?.signer.length ?? 0).toBeGreaterThan(0);
      expect(artifact.signature?.keyId.length ?? 0).toBeGreaterThan(0);
      expect(artifact.signature?.path.endsWith(".sig")).toBe(true);
      expect(artifact.signature?.receipt).not.toBeNull();
    }

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
      { GNUPGHOME: home },
    );
    expect(verified.status, verified.output).toBe(0);
    expect(verified.output).toContain("signature verified against the published keyring");

    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test("it refuses a signature that does not verify against the published keyring", async () => {
    const stage = await dryRunStaging("tanit-release-wrongkey");
    const home = await tempDir("tanit-release-gnupg-wrong");
    const keyId = createThrowawayKey(home);
    expect(keyId).not.toBeNull();
    if (keyId === null) return;

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        GNUPGHOME: home,
        TANIT_SIGN_GPG_KEY_ID: keyId,
        TANIT_SIGN_GPG_KEYRING: "tanit-release-keyring.gpg",
      },
    );
    expect(signed.status, signed.output).toBe(0);
    expect(run("bun", ["run", PREPARE, "--stage", stage]).status).toBe(0);

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
      { GNUPGHOME: home },
    );
    expect(verified.status).not.toBe(0);
    expect(verified.output).toContain("does not verify against the published keyring");

    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test("it refuses an artifact that changed after it was signed", async () => {
    const stage = await dryRunStaging("tanit-release-after-sign");
    const home = await tempDir("tanit-release-gnupg-after");
    const keyId = createThrowawayKey(home);
    expect(keyId).not.toBeNull();
    if (keyId === null) return;

    const signed = run(
      "bash",
      [SIGN_LINUX, "--stage", stage, "--os", "linux", "--arch", "x64"],
      {
        GNUPGHOME: home,
        TANIT_SIGN_GPG_KEY_ID: keyId,
        TANIT_SIGN_GPG_KEYRING: "tanit-release-keyring.gpg",
      },
    );
    expect(signed.status, signed.output).toBe(0);
    expect(run("bun", ["run", PREPARE, "--stage", stage]).status).toBe(0);

    // Se cambia el artefacto después de firmarlo: el digest del
    // manifest ya no describe los bytes que se publicarían.
    await writeFile(
      join(stage, "linux", "x64", "deb", "Tanit_0.1.0_x64.deb"),
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
      { GNUPGHOME: home },
    );
    expect(verified.status).not.toBe(0);
    expect(verified.output).toContain("digest does not match");

    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 4. La matriz de credenciales que faltan
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
// 5. Lo que la release promete en el papel
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

  test("the workflow publishes only signed artifacts and fails closed without signing", async () => {
    const workflow = await readFile(
      join(REPO_ROOT, ".github", "workflows", "release-desktop.yml"),
      "utf8",
    );

    // La publicación exige `release.sign=true`.
    expect(workflow).toContain("release.sign=true");
    expect(workflow).toContain("needs: build");

    // Y lo que se adjunta son los formatos firmados, nada más.
    for (const pattern of ["*.dmg", "*.app.zip", "*.msi", "*-setup.exe", "*.deb", "*.AppImage"]) {
      expect(workflow).toContain(pattern);
    }
    expect(workflow).toContain("SHA256SUMS");
    expect(workflow).toContain("verify-signature.sh");

    // El gate de credenciales corre **antes** de construir.
    const auditAt = workflow.indexOf("prepare-artifacts.mjs \\\n            --check-credentials");
    const buildAt = workflow.indexOf("bun run desktop:build");
    expect(auditAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(auditAt, "the credential audit must run before the build").toBeLessThan(buildAt);
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
    const workflow = await readFile(
      join(REPO_ROOT, ".github", "workflows", "release-desktop.yml"),
      "utf8",
    );

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

  test("the workflow asks the build script for the bundles the matrix declares", async () => {
    const workflow = await readFile(
      join(REPO_ROOT, ".github", "workflows", "release-desktop.yml"),
      "utf8",
    );

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
    expect(docs.toLowerCase()).toContain("reproducible");
  });
});
