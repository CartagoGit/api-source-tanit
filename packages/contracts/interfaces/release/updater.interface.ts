/**
 * El contrato del updater firmado de Tanit.
 *
 * El updater no descarga: **decide si lo descargado se puede
 * instalar**. Por eso el contrato tiene dos mitades que no se pueden
 * separar:
 *
 *   · El **manifest**, que dice qué versión hay, para qué plataforma,
 *     con qué hash y con qué firma. Viaja firmado.
 *   · El **contrato de inicialización**, que dice de dónde se lee el
 *     manifest, con qué clave pública se verifica, qué versión tiene
 *     la app instalada y cuánto se espera y reintenta.
 *
 * ## Por qué vive en `packages/contracts`
 *
 * Porque lo usan **tres** sitios que no comparten código: el script
 * que construye el manifest (`scripts/release/build-update-manifest.mjs`),
 * el verificador independiente (`scripts/release/verify-update.sh`) y el
 * cliente nativo (`packages/desktop/src/updater.rs`). Cuando cada uno
 * inventa su propio formato, la verificación deja de comprobar nada y
 * pasa a comprobar que los ficheros existen.
 *
 * ## Por qué el hash y la firma van juntos
 *
 * Un hash sin firma dice "esto no ha cambiado". Una firma sin hash
 * dice "esto lo firmó alguien". Juntos dicen "esto lo firmó alguien
 * **y** no ha cambiado". Separados son dos afirmaciones que pueden no
 * hablar del mismo fichero, y un updater que acepta una sin la otra no
 * está verificando nada.
 *
 * ## Por qué la clave es *versionada*
 *
 * El manifest declara qué clave lo firmó (`publicKeyId`) y el cliente
 * declara con qué clave verifica. Si los dos no coinciden, el cliente
 * aborta. Eso convierte la rotación en un acto explícito —publicar una
 * clave nueva, versionarla y cambiar el contrato— en vez de un
 * silencioso cambio de fichero que invalida las actualizaciones en
 * curso sin que nadie lo note.
 */

/** Un sistema operativo al que apunta un destino de actualización. */
export type UpdateOs = "macos" | "windows" | "linux";

/** Una arquitectura de CPU a la que apunta un destino de actualización. */
export type UpdateArch = "x64" | "arm64";

/**
 * Un formato de instalador.
 *
 * Los mismos seis que la release: `app` y `dmg` de macOS, `msi` y
 * `nsis` de Windows, `deb` y `appimage` de Linux. El bundle se llama
 * `nsis` y no `exe` porque lo que se firma es el bundle, no el
 * sufijo del fichero.
 */
export type UpdateBundle = "app" | "dmg" | "msi" | "nsis" | "deb" | "appimage";

/**
 * La plataforma donde corre la app instalada.
 *
 * Es la que se compara con los destinos del manifest: si no hay un
 * destino exacto para esta plataforma, la actualización no existe.
 */
export interface IUpdatePlatform {
  readonly os: UpdateOs;
  readonly arch: UpdateArch;
  readonly bundle: UpdateBundle;
}

/**
 * Un destino concreto del manifest: un instalador y su identidad.
 *
 * `signature` es la firma Ed25519 del **instalador**, no la del
 * manifest. Son dos firmas distintas porque son dos cosas distintas:
 * una acredita el manifest (y por tanto la URL y el hash que lleva) y
 * la otra acredita los bytes que se van a instalar.
 */
export interface IUpdateTarget {
  readonly os: UpdateOs;
  readonly arch: UpdateArch;
  readonly bundle: UpdateBundle;
  /** De dónde se descarga. Solo HTTPS: el cliente no acepta otra cosa. */
  readonly url: string;
  /** SHA-256 en hexadecimal minúsculas, recalculado sobre el fichero. */
  readonly sha256: string;
  /** Firma Ed25519 del instalador, en base64. */
  readonly signature: string;
  /** Tamaño del instalador en bytes, para acotar la descarga. */
  readonly size: number;
}

/**
 * De dónde viene el artefacto.
 *
 * Va **dentro** del manifest firmado, así que no es una nota: es
 * parte de lo que la firma cubre. Un artefacto sin procedencia
 * declarada no es instalable.
 */
export interface IUpdateProvenance {
  /** De dónde sale la build: el workflow, el script o el proceso. */
  readonly source: string;
  /** El workflow o el job que la produjo, si aplica. */
  readonly workflow?: string;
  /** El commit desde el que se construyó. */
  readonly commit?: string;
  /** ISO-8601 de cuándo se construyó. */
  readonly builtAt?: string;
}

/**
 * El manifest de actualización, firmado.
 *
 * Lo produce `scripts/release/build-update-manifest.mjs` y lo consume
 * el cliente nativo. Viaja por HTTPS y llega firmado: un manifest sin
 * firma no es un manifest, es una sugerencia.
 */
export interface IUpdateManifest {
  /** Discriminante de formato. Cambia si cambia la forma del manifest. */
  readonly schema: string;
  /** Versión semver que se ofrece. */
  readonly version: string;
  /**
   * La versión más antigua que este manifest todavía soporta.
   *
   * Si la app instalada es más vieja que esto, el manifest está
   * describiendo una actualización que el cliente no puede aceptar
   * por sí solo: hay que ir a por la release a mano.
   */
  readonly minimumSupportedVersion: string;
  /** ISO-8601 de cuándo se generó el manifest. */
  readonly generatedAt: string;
  /** Qué clave pública firmó este manifest. */
  readonly publicKeyId: string;
  /** El algoritmo de la firma. Solo hay uno: `ed25519`. */
  readonly signatureAlgorithm: "ed25519";
  /** Los instaladores que se ofrecen, uno por plataforma. */
  readonly targets: readonly IUpdateTarget[];
  /** De dónde viene la build que se ofrece. */
  readonly provenance: IUpdateProvenance;
}

/**
 * La política de reintentos del endpoint.
 *
 * Se declara en vez de codificarse porque "reintentar tres veces con
 * espera creciente" y "reintentar una vez sin esperar" son decisiones
 * de producto: la primera absorbe un endpoint intermitente, la segunda
 * hace que el usuario espere. Lo que no puede cambiar es que **el
 * fallo es un fallo**: reintentar no cambia el criterio de aceptación.
 */
export interface IUpdateRetryPolicy {
  /** Cuántos intentos, en total, se hacen de una misma petición. */
  readonly maxAttempts: number;
  /** La espera del primer reintento, en milisegundos. */
  readonly initialBackoffMs: number;
  /** El techo de la espera, en milisegundos. */
  readonly maxBackoffMs: number;
  /** Por qué se multiplica la espera en cada reintento. */
  readonly multiplier: number;
}

/**
 * El contrato con el que se inicializa el updater.
 *
 * Es **explícito**: no hay valores implícitos escondidos en el
 * cliente. De dónde se lee, con qué clave se verifica, qué versión
 * tiene la app y cuánto se espera son datos, no decisiones que se
 * toman al vuelo.
 */
export interface IUpdaterContract {
  /** De dónde se lee el manifest. Solo HTTPS. */
  readonly endpoint: string;
  /** El identificador de la clave pública con la que se verifica. */
  readonly publicKeyId: string;
  /** Dónde vive la clave pública versionada, dentro del repo. */
  readonly publicKeyPath: string;
  /** La versión semver de la app instalada. */
  readonly currentVersion: string;
  /** El tiempo máximo de una petición, en milisegundos. */
  readonly timeoutMs: number;
  /** La política de reintentos. */
  readonly retry: IUpdateRetryPolicy;
}

/**
 * Por qué el updater aborta.
 *
 * Son **códigos**, no mensajes: el mensaje se le enseña a la persona
 * y el código lo consume el log y la telemetría. Un aborta siempre
 * lleva las dos cosas, y el código es estable aunque el mensaje
 * cambie de redacción.
 */
export type UpdateRejectionCode =
  | "update.endpoint.missing"
  | "update.endpoint.not_https"
  | "update.endpoint.unavailable"
  | "update.manifest.missing"
  | "update.manifest.invalid"
  | "update.manifest.schema_mismatch"
  | "update.public_key.invalid"
  | "update.public_key.mismatch"
  | "update.signature.invalid"
  | "update.version.not_newer"
  | "update.version.below_minimum"
  | "update.target.unsupported"
  | "update.download.failed"
  | "update.hash.mismatch"
  | "update.size.mismatch";

/**
 * Un aborto del updater, ya explicado.
 *
 * `securityEvent` dice si esto es un **intento de ataque** o un
 * problema de operación. Un endpoint caído no es un ataque; una firma
 * corrupta sí lo es. La app los trata distinto: el primero permite
 * reintentar, el segundo deja rastro.
 */
export interface IUpdateRejection {
  /** El código estable del motivo. */
  readonly code: UpdateRejectionCode;
  /** El mensaje que ve la persona. */
  readonly message: string;
  /** Si hay que registrar un evento de seguridad. */
  readonly securityEvent: boolean;
}
