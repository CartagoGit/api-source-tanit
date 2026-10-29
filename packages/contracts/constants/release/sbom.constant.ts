/**
 * Las constantes del SBOM CycloneDX y de la attestation de provenance.
 *
 * Viven en contratos porque **tres** sitios tienen que decir lo mismo:
 * el script que construye el SBOM (`scripts/release/build-sbom.mjs`), el
 * que lo verifica (`scripts/release/verify-sbom.mjs`) y el test que
 * prueba los dos (`tests/release/sbom.spec.ts`). Cuando uno de ellos
 * lleva su propio valor, el verificador deja de comprobar nada: el
 * constructor dice `1.5` y el verificador espera `1.6`, y el resultado es
 * un fallo de versión que nadie sabe leer.
 *
 * ## Por qué el formato es un literal y no un parámetro
 *
 * Porque el formato del SBOM **es** el contrato con el auditor. Un
 * `specVersion` que se pueda cambiar por bandera no es un contrato: es
 * una sugerencia. La versión 1.6 es la que se publica, la que se
 * verifica y la que dice `docs/SBOM.md`.
 *
 * ## La provenance es SLSA
 *
 * El predicado es `https://slsa.dev/provenance/v1`, que es lo que
 * `actions/attest-build-provenance` produce y lo que un verificador
 * externo (Sigstore, el playground de SLSA, un auditor con `cosign`)
 * sabe leer. El envelope es DSSE, con el payload en base64 y la
 * firma sobre el PAE — el mismo formato de fichero que usa la
 * attestation de GitHub, línea a línea.
 */

import type { ReleaseOs } from "../../interfaces/release/signing.interface.js";

/** El formato que declara el documento. */
export const SBOM_FORMAT = "CycloneDX";

/**
 * La versión del formato CycloneDX que genera y valida Tanit.
 *
 * 1.6 es la primera que declara `metadata.tools` como objeto y que
 * admite `metadata.supplier` con una lista de URLs. Con 1.5 el
 * verificador tendría que aceptar dos formas del mismo campo, y con
 * dos formas un campo deja de comprobar nada.
 */
export const SBOM_SPEC_VERSION = "1.6";

/** Sufijo del fichero SBOM. */
export const SBOM_FILE_SUFFIX = ".cdx.json";

/**
 * Sufijo del fichero de provenance.
 *
 * Es el statement in-toto **en claro**: lo que se lee, lo que se
 * indexa y lo que un auditor compara sin herramientas. La versión
 * firmada es la attestation, que va aparte.
 */
export const SBOM_PROVENANCE_FILE_SUFFIX = ".provenance.json";

/**
 * Sufijo del fichero de attestation.
 *
 * `.intoto.jsonl` y no `.json`: el formato de attestation de GitHub es
 * un JSONL con un envelope DSSE por línea, y una release puede llevar
 * más de una attestation (una por plataforma). Un `.json` que puede
 * contener dos o tres envelopes es un formato que nadie sabe leer.
 */
export const SBOM_ATTESTATION_FILE_SUFFIX = ".intoto.jsonl";

/** El `payloadType` que lleva el envelope DSSE. */
export const SBOM_PAYLOAD_TYPE = "application/vnd.in-toto+json";

/** El `_type` del statement in-toto. */
export const SBOM_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";

/** El `predicateType` de la provenance SLSA. */
export const SBOM_PROVENANCE_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";

/** Los algoritmos de hash que el SBOM puede declarar. */
export const SBOM_HASH_ALGORITHMS = ["SHA-256", "SHA-512"] as const;

/**
 * Los componentes que un SBOM de Tanit tiene que llevar sí o sí.
 *
 * Son los dos que el producto **es**: la ventana de escritorio y el
 * sidecar que lleva dentro. Un SBOM sin el sidecar no describe lo que
 * se publica, porque el sidecar es la mitad del producto y es lo que
 * habla con el proyecto del usuario.
 */
export const SBOM_REQUIRED_COMPONENTS = ["tanit-desktop", "tanit-apisrc"] as const;

/**
 * El nombre del componente de la ventana de escritorio.
 *
 * Va como nombre de componente CycloneDX y como `bom-ref` raíz.
 */
export const SBOM_DESKTOP_COMPONENT = "tanit-desktop";

/** El nombre del componente del sidecar. */
export const SBOM_SIDECAR_COMPONENT = "tanit-apisrc";

/**
 * Las raíces del grafo de dependencias de Bun.
 *
 * Son las dependencias de **runtime** que el CLI usa de verdad —las
 * que `bun build --compile` mete dentro del sidecar—. Las de
 * desarrollo (Angular, vitest, jsdom) no entran: no viajan en el
 * binario que se publica, y un SBOM que las lista dice que se
 * distribuye un compilador de TypeScript.
 */
export const SBOM_BUN_RUNTIME_ROOTS = ["zod", "@babel/parser", "@babel/types"] as const;

/**
 * Las bibliotecas nativas que la app enlaza en cada plataforma.
 *
 * ## La honestidad de esta lista
 *
 * No sale de un escaneo del binario: sale de lo que la app **enlaza**
 * contra el sistema. En Linux son las que instala el workflow; en
 * macOS y Windows son las del sistema o las que trae el runtime. La
 * versión es `system` porque el número de versión lo pone el sistema
 * operativo, no la release.
 *
 * La alternativa —analizar el binario firmado— daría el mismo conjunto
 * con peor resolución y no distinguiría una biblioteca del sistema de
 * una que va empaquetada. `docs/SBOM.md` dice cuál de las dos es.
 */
export const SBOM_NATIVE_COMPONENTS: Readonly<Record<ReleaseOs, readonly string[]>> = {
  linux: [
    "libwebkit2gtk-4.1",
    "libgtk-3",
    "libsoup-3.0",
    "libjavascriptcoregtk-4.1",
    "librsvg-2",
    "libayatana-appindicator3",
    "libglib-2.0",
    "libpango-1.0",
    "libcairo-2",
    "libgdk-pixbuf-2.0",
    "patchelf",
  ],
  macos: ["webkit-system-framework", "appkit-system-framework"],
  windows: ["webview2-runtime", "ucrt-base-runtime"],
};

/**
 * Los ficheros que **nunca** entran en el SBOM ni en la release.
 *
 * La regla es de dos mitades: el SBOM no los describe, y si uno está
 * en el staging la release para. Un staging con una clave privada dentro
 * es un staging que publica una clave privada, y un SBOM que no la
 * menciona no arregla eso: sólo esconde la prueba.
 *
 * Los patrones miran el **nombre** del fichero, que es donde se
 * esconden: `id_ed25519`, `server.key`, `credentials.json`, `.env`.
 */
export const SBOM_EXCLUDED_FILE_PATTERNS: readonly string[] = [
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.env",
  "**/.env.*",
  "**/*.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/*credential*",
  "**/*secret*",
  "**/*token*",
  "**/*.tmp",
  "**/*.temp",
  "**/*.partial",
  "**/*.crdownload",
  "**/*~",
  "**/*.swp",
  "**/.DS_Store",
];

/**
 * El identificador de la clave que firma la attestation, por defecto.
 *
 * Es el mismo nombre versionado que usan las claves de la release: la
 * rotación es un acto visible (cambia el identificador y se publica la
 * clave nueva), no un cambio silencioso de fichero.
 */
export const SBOM_DEFAULT_KEY_ID = "tanit-release-attestation-v1";

/**
 * El builder por defecto de la provenance.
 *
 * La URL del workflow: es lo que dice de dónde salió la build, y lo
 * comprueba quien verifica sin tener que creerle al documento.
 */
export const SBOM_DEFAULT_BUILDER_ID =
  "https://github.com/CartagoGit/api-source-tanit/.github/workflows/release-desktop.yml";

/**
 * La versión del SBOM: la primera.
 *
 * CycloneDX lleva la versión del **documento**, no la del producto: un
 * SBOM regenerado con el mismo contenido es el mismo documento, y sólo
 * se incrementa cuando el contenido cambia de forma que invalida al
 * anterior. El producto lleva su versión en `metadata.component.version`.
 */
export const SBOM_DOCUMENT_VERSION = 1;
