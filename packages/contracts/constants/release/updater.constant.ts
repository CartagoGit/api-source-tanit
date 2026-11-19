/**
 * Las constantes del updater firmado.
 *
 * Viven en contratos porque las tienen que decir **tres** sitios: el
 * script que construye el manifest, el verificador independiente y el
 * cliente nativo. Cuando uno de ellos lleva su propio valor, el
 * updater deja de comprobar nada: firma un manifest con un esquema y
 * el cliente espera otro, y el resultado es un error de versión que
 * nadie sabe leer.
 *
 * ## La clave pública es un fichero versionado, no un literal
 *
 * La clave que verifica el manifest vive en
 * `packages/desktop/keys/tanit-updater-public-key-v1.pem`, y su
 * identificador (`tanit-updater-v1`) va dentro del nombre del
 * fichero. Rotar la clave es, entonces, un acto visible: se publica
 * `tanit-updater-public-key-v2.pem`, se cambia el identificador y
 * ambos clientes —el nativo y el script— leen el nuevo.
 *
 * La **privada** no está aquí, ni en el repo, ni en los logs: vive en
 * el almacén de secretos del CI y sale de él solo para firmar.
 */

import type {
  IUpdatePlatform,
  IUpdateRetryPolicy,
  UpdateRejectionCode,
} from "../../interfaces/release/updater.interface.js";

/** Discriminante del manifest de actualización. */
export const UPDATE_MANIFEST_SCHEMA = "tanit.update.manifest/v1";

/** El único algoritmo de firma que el updater entiende. */
export const UPDATE_SIGNATURE_ALGORITHM = "ed25519";

/** Nombre del manifest dentro del directorio de publicación. */
export const UPDATE_MANIFEST_FILE = "latest.json";

/**
 * Nombre del fichero de firma del manifest.
 *
 * Vive al lado del manifest y con la misma raíz, como en Tauri: el
 * cliente lee `latest.json` y pide `latest.json.sig`. La firma va
 * **fuera** del manifest a propósito — si fuera un campo dentro, el
 * cliente tendría que parsesar un documento que todavía no sabe si es
 * de fiar para decidir si es de fiar.
 */
export const UPDATE_SIGNATURE_FILE = "latest.json.sig";

/** El identificador de la clave pública versionada que hay en el repo. */
export const UPDATE_PUBLIC_KEY_ID = "tanit-updater-v1";

/**
 * La versión más antigua que el canal de actualización todavía
 * soporta.
 *
 * Es la **política** del canal, no un dato del cliente: dice desde qué
 * versión una app instalada todavía puede actualizarse sola. Si la app
 * es más vieja que esto, el updater aborta con
 * `update.version.below_minimum` y la actualización se hace a mano.
 *
 * Vive aquí, y no en el script que construye el manifest, por una
 * razón concreta: el manifest lleva este valor **dentro y firmado**,
 * y el script lo toma de aquí. Si el valor viviera en el script, el
 * manifest y el pipeline podrían decir cosas distintas —y el error
 * sería invisible hasta que un cliente dejara de poder actualizarse.
 *
 * El valor por defecto del script **no** puede ser la versión de la
 * release: el manifest ofrecería la versión nueva como mínima, y
 * cualquier cliente anterior quedaría fuera del canal.
 */
export const UPDATE_MINIMUM_SUPPORTED_VERSION = "1.0.0";

/** Dónde vive la clave pública versionada, relativo a la raíz del repo. */
export const UPDATE_PUBLIC_KEY_PATH =
  "packages/desktop/keys/tanit-updater-public-key-v1.pem";

/**
 * El endpoint por defecto del manifest.
 *
 * Solo HTTPS. No hay alternativa en HTTP: el cliente aborta antes de
 * pedir nada, y esa es la mitad del motivo por el que la clave
 * pública está en la app.
 */
export const UPDATE_DEFAULT_ENDPOINT = "https://updates.tanit.dev/latest.json";

/** El tiempo máximo de una petición, en milisegundos. */
export const UPDATE_DEFAULT_TIMEOUT_MS = 15000;

/**
 * La política de reintentos por defecto.
 *
 * Tres intentos con espera creciente y techo de cuatro segundos: lo
 * justo para que un endpoint intermitente no se sienta como caído, y
 * poco para que una app que no puede actualizar no se quede colgada.
 */
export const UPDATE_DEFAULT_RETRY: IUpdateRetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 4000,
  multiplier: 2,
};

/**
 * La matriz de destinos que el manifest debe cubrir.
 *
 * Es la misma matriz que la release (`RELEASE_TARGET_MATRIX`), porque
 * el updater ofrece exactamente los instaladores que la release
 * publica. Vive aquí aparte para que el cliente no dependa de las
 * constantes de firma: el updater tiene que poder leer un manifest
 * sin saber cómo se firmó la release.
 */
export const UPDATE_TARGET_MATRIX: readonly IUpdatePlatform[] = [
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
 * Los códigos de aborto del updater.
 *
 * El mapa es de código a código, y existe para que el cliente nativo
 * y el verificador de consola usen **las mismas cadenas**: un
 * `update.signature.invalid` tiene que decir lo mismo en el log de
 * la app y en el del verificador, o el que triaje un incidente tiene
 * dos vocabularios que casar a mano.
 */
export const UPDATE_REJECTION_CODES: Readonly<Record<UpdateRejectionCode, string>> = {
  "update.endpoint.missing": "update.endpoint.missing",
  "update.endpoint.not_https": "update.endpoint.not_https",
  "update.endpoint.unavailable": "update.endpoint.unavailable",
  "update.manifest.missing": "update.manifest.missing",
  "update.manifest.invalid": "update.manifest.invalid",
  "update.manifest.schema_mismatch": "update.manifest.schema_mismatch",
  "update.public_key.invalid": "update.public_key.invalid",
  "update.public_key.mismatch": "update.public_key.mismatch",
  "update.signature.invalid": "update.signature.invalid",
  "update.version.not_newer": "update.version.not_newer",
  "update.version.below_minimum": "update.version.below_minimum",
  "update.target.unsupported": "update.target.unsupported",
  "update.download.failed": "update.download.failed",
  "update.hash.mismatch": "update.hash.mismatch",
  "update.size.mismatch": "update.size.mismatch",
};

/**
 * Los abortos que son un **evento de seguridad**.
 *
 * La lista es explícita y corta a propósito: un endpoint caído es un
 * problema de operación y se puede reintentar; una firma que no
 * cuadra, un hash que no cuadra o una clave que no es la esperada
 * son intentos de sustituir lo que se instala, y se registran como
 * tales.
 */
export const UPDATE_SECURITY_EVENT_CODES: readonly UpdateRejectionCode[] = [
  "update.public_key.invalid",
  "update.public_key.mismatch",
  "update.signature.invalid",
  "update.hash.mismatch",
  "update.size.mismatch",
];
