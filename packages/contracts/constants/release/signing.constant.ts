/**
 * La matriz de la release y las credenciales que cada plataforma exige.
 *
 * Vive en contratos porque **cuatro** sitios tienen que coincidir: el
 * script que prepara el manifest, el que audita credenciales, el que
 * verifica y el workflow que publica. Cuando uno de ellos Lista los
 * targets de memoria, la release se publica con un `.msi` que nadie ha
 * firmado o con un `.dmg` sin el `.app` que el otro runner promises.
 *
 * ## Los targets, y por qué no hay más
 *
 * La primera release cubre macOS x64 y arm64, Windows x64 y Linux x64.
 * Windows ARM64 y Linux ARM64 no están: no es que se hayan olvidado,
 * es que cada target multiplica el número de firmantes y de
 * credenciales que hay que mantener, y un target sin firmar es peor que
 * un target que no existe.
 *
 * ## Las credenciales, por nombre
 *
 * Cada proveedor declara los **nombres** de las variables que necesita,
 * nunca sus valores. El valor vive en el almacén de secretos del CI;
 * el nombre vive aquí, porque es lo que hay que auditar y lo que hay
 * que documentar en `docs/RELEASE.md`.
 */

import type {
  IReleaseTarget,
  ISigningProviderSpec,
  ReleaseAssetKind,
  ReleaseBundle,
} from "../../interfaces/release/signing.interface.js";

/**
 * Si se firma o no, por defecto.
 *
 * `false`: el desarrollo local no tiene certificados de Apple, ni de
 * Microsoft, ni una clave GPG, y no debería exigirlos para poder
 * compilar. Con `true` la publicación pasa a exigir credenciales **y**
 * firmas verificadas — y a fallar cerrado si falta cualquiera de las dos.
 */
export const RELEASE_SIGN_DEFAULT = false;

/**
 * Dónde vive la política de firma dentro de `delendai.config.json`.
 *
 * **No** está en la raíz del fichero: la raíz la valida el host con su
 * propio esquema, y una clave que el host no conoce sale como
 * incidencia en cada arranque. Vive en las opciones del plugin
 * `tanit` —que es de este repositorio—, y de ahí la leen el script de
 * la release y el workflow que la publica.
 *
 * El bloque es `plugins.tanit.options.release`; la palanca que lo
 * decide es su campo `sign`.
 */
export const RELEASE_SIGN_CONFIG_PATH = "plugins.tanit.options.release";

/** Discriminante del manifest. Si cambia la forma, cambia esto. */
export const RELEASE_MANIFEST_SCHEMA = "tanit.release.manifest/v1";

/** Nombre del manifest dentro del staging. */
export const RELEASE_MANIFEST_FILE = "release-manifest.json";

/** Nombre del fichero de checksums de Linux. */
export const RELEASE_CHECKSUMS_FILE = "SHA256SUMS";

/** Sufijo de las firmas detached de GPG. */
export const RELEASE_DETACHED_SIGNATURE_SUFFIX = ".sig";

/**
 * Sufijo del recibo que escribe el script que firmó.
 *
 * El recibo es lo que ata la firma a los bytes exactos que se
 * publicaron: lleva el digest del artefacto **en el momento de
 * firmarlo**. Sin él, la firma sólo dice "algo está firmado", y no
 * sobre qué.
 */
export const RELEASE_RECEIPT_SUFFIX = ".signature.json";

/** Nombre del keyring público de la release. */
export const RELEASE_KEYRING_FILE = "tanit-release-keyring.gpg";

/**
 * Los patrones de lo que se adjunta a la release.
 *
 * Vive aquí —y no en el workflow— porque **dos** sitios tienen que
 * decir lo mismo: el gate que decide si la release se publica y el
 * paso que sube los ficheros. Cuando uno de los dos lleva su propia
 * lista, la release se publica con el manifest equivocado: un glob
 * recursivo de `release-manifest.json` encuentra el manifest por
 * plataforma y el mergeado, y la acción que sube los assets nombra
 * cada uno por su `basename`, así que el último que sube pisa al
 * primero y en la release queda un manifest parcial de una plataforma.
 *
 * Por eso el manifest se lista **por su ruta exacta** y no con un
 * glob: sólo el mergeado se publica, y los manifest por plataforma
 * son estado intermedio del runner.
 *
 * Los patrones son relativos a la raíz del staging.
 */
export const RELEASE_PUBLISH_PATTERNS: readonly string[] = [
  RELEASE_MANIFEST_FILE,
  "**/*.dmg",
  "**/*.app.zip",
  "**/*.msi",
  "**/*-setup.exe",
  "**/*.deb",
  "**/*.AppImage",
  `**/*${RELEASE_DETACHED_SIGNATURE_SUFFIX}`,
  `**/${RELEASE_CHECKSUMS_FILE}`,
  "**/*.gpg",
  // La transparencia de la cadena de suministro: el SBOM, el statement
  // de provenance y la attestation firmada. Sin estos tres no se puede
  // auditar lo que se descarga, así que el gate exige que estén —y que
  // se adjunten— antes de publicar.
  "**/*.cdx.json",
  "**/*.provenance.json",
  "**/*.intoto.jsonl",
  // La clave pública de la attestation **no** viene de aquí: la
  // versiona el repositorio y la adjunta el gate **por su ruta**
  // (`SBOM_ATTESTATION_PUBLIC_KEY_PATH`). Un glob que la buscara en el
  // staging tendría dos problemas: cuatro copias por plataforma
  // subirían con el mismo `basename` y la última pisaría a las demás, y
  // una copia del staging que el manifest no describe sería un asset
  // que nadie ha auditado. Con una sola clave —la versionada— el gate
  // no puede adjuntar la equivocada.
];

/**
 * Los assets que una release tiene que llevar para poder publicarse.
 *
 * Son los que hacen auditable la descarga: sin SBOM nadie sabe qué
 * lleva el binario, sin provenance nadie sabe de dónde vino y sin
 * attestation firmada nadie sabe quién dice que vino de ahí. Los tres
 * van juntos, y `publish-gate.mjs` falla cerrado si falta alguno.
 */
export const RELEASE_REQUIRED_ASSET_KINDS: readonly ReleaseAssetKind[] = [
  "sbom",
  "provenance",
  "attestation",
];

/** La matriz de destinos de la release de escritorio. */
export const RELEASE_TARGET_MATRIX: readonly IReleaseTarget[] = [
  { os: "macos", arch: "x64", bundle: "app" },
  { os: "macos", arch: "x64", bundle: "dmg" },
  { os: "macos", arch: "arm64", bundle: "app" },
  { os: "macos", arch: "arm64", bundle: "dmg" },
  { os: "windows", arch: "x64", bundle: "msi" },
  { os: "windows", arch: "x64", bundle: "nsis" },
  { os: "linux", arch: "x64", bundle: "deb" },
  { os: "linux", arch: "x64", bundle: "appimage" },
];

/**
 * Cómo se reconoce cada formato de instalador dentro del staging.
 *
 * Son sufijos de fichero, no extensiones: el instalador de Windows es
 * un `Tanit_0.2.0_x64-setup.exe`, y el `.exe` de su final no dice que
 * sea un NSIS —lo dice el `-setup` de delante. Por eso los dos
 * formatos de Windows se distinguen por sufijo y no por extensión.
 */
export const RELEASE_BUNDLE_FILE_SUFFIX: Readonly<Record<ReleaseBundle, string>> = {
  // El `.app` es un directorio: un directorio no tiene un digest, así
  // que lo que se publica es el `.app` comprimido. El bundle sigue
  // llamándose `app` porque lo que se firma y notariza es el bundle.
  app: ".app.zip",
  dmg: ".dmg",
  msi: ".msi",
  nsis: "-setup.exe",
  deb: ".deb",
  appimage: ".AppImage",
};

/**
 * Los proveedores de credenciales, uno por plataforma.
 *
 * `requiredEnv` es lo que sin lo cual **no** se puede firmar. La
 * diferencia con `optionalEnv` no es de convenience: lo obligatorio es
 * lo que la pipeline audita antes de empezar, y lo opcional ajusta el
 * comportamiento sin decidir si la release puede salir firmada.
 */
export const SIGNING_PROVIDERS: readonly ISigningProviderSpec[] = [
  {
    id: "apple",
    os: "macos",
    requiredEnv: [
      "TANIT_SIGN_APPLE_IDENTITY",
      "TANIT_SIGN_APPLE_TEAM_ID",
      "TANIT_SIGN_NOTARY_PROFILE",
    ],
    optionalEnv: ["TANIT_SIGN_ENTITLEMENTS", "TANIT_SIGN_KEYCHAIN"],
  },
  {
    id: "windows",
    os: "windows",
    requiredEnv: [
      "TANIT_SIGN_WINDOWS_THUMBPRINT",
      "TANIT_SIGN_WINDOWS_TIMESTAMP_URL",
    ],
    optionalEnv: [
      "TANIT_SIGN_WINDOWS_TRUSTED_SIGNING_ACCOUNT",
      "TANIT_SIGN_WINDOWS_CERTIFICATE",
    ],
  },
  {
    id: "gnupg",
    os: "linux",
    requiredEnv: ["TANIT_SIGN_GPG_KEY_ID", "TANIT_SIGN_GPG_KEYRING"],
    optionalEnv: ["TANIT_SIGN_GPG_PASSPHRASE"],
  },
];

/**
 * Los entitlements mínimos de macOS.
 *
 * Tauri usa un WebView del sistema, y sin `allow-jit` el proceso no
 * arranca en una app firmada. `allow-unsigned-executable-memory` es el
 * otro que Tauri documenta para WebKit. No hay nada más: un
 * entitlement de más es una capacidad de más para un atacante que
 * consiga ejecutar código dentro del proceso.
 */
export const MACOS_MINIMAL_ENTITLEMENTS: readonly string[] = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
];

/** Dónde vive el fichero de entitlements que se aplica al firmar. */
export const MACOS_ENTITLEMENTS_PATH = "packages/desktop/entitlements/Tanit.entitlements.plist";

/** Timestamp por defecto para Authenticode (RFC 3161). */
export const WINDOWS_DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";
