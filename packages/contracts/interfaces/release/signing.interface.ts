/**
 * El contrato de firma de la release de escritorio.
 *
 * Existe para que **cuatro** sitios digan lo mismo y no tres: el
 * script que prepara el manifest, el que firma por plataforma, el que
 * verifica y el workflow que publica. Si uno de ellos inventa su
 * propio formato, la verificación deja de comprobar nada y sólo
 * comprueba que los ficheros existen.
 *
 * ## El manifest es efímero
 *
 * No es un formato publicado: es el resultado de **medir** los
 * artefactos finales en el staging de la release, y se borra al
 * terminar. Por eso describe el resultado —`sha256`, `signer`,
 * `keyId`— y no la manera de obtenerlo. La manera vive en los
 * scripts y en las herramientas de cada plataforma, que cambian
 * (notarytool, signtool, gpg) sin que el manifest se entere.
 *
 * ## Identidad, no bits
 *
 * Una release es reproducible **en identidad**, no bit a bit: dos
 * compilaciones del mismo commit dan artefactos distintos (fechas,
 * orden de enlazado, compressed ids), pero la firma y el digest
 * que se publican describen exactamente los bytes que se adjuntaron.
 * Por eso el manifest guarda el digest y la firma juntos: juntos son
 * la prueba; separados son dos afirmaciones que pueden no ser del
 * mismo fichero.
 */

/** Un sistema operativo al que la release de escritorio apunta. */
export type ReleaseOs = "macos" | "windows" | "linux";

/** Una arquitectura de CPU a la que la release de escritorio apunta. */
export type ReleaseArch = "x64" | "arm64";

/**
 * Un formato de instalador.
 *
 * `app` y `dmg` son los de macOS, `msi` y `nsis` los de Windows, y
 * `deb` y `appimage` los de Linux. El instalador de Windows es un
 * `.exe` de NSIS, y por eso el bundle se llama `nsis` y no `exe`:
 * el nombre dice **qué** se firma, no sólo cómo se llama.
 */
export type ReleaseBundle = "app" | "dmg" | "msi" | "nsis" | "deb" | "appimage";

/**
 * Cómo se produjo una firma.
 *
 * `codesign` y `authenticode` van **embebidas** en el binario: la
 * firma es el propio fichero, y por eso `path` apunta al artefacto.
 * `gpg-detached` va en un `.sig` aparte, y `notarization` es el
 * recibo de `notarytool` —no una firma, sino la aceptación del
 * ticket que se estapla dentro del artefacto.
 */
export type ReleaseSignatureKind = "codesign" | "notarization" | "authenticode" | "gpg-detached";

/** Una clase de fichero que acompaña a la release sin ser instalable. */
export type ReleaseAssetKind =
  | "checksums"
  | "checksums-signature"
  | "keyring"
  | "sbom"
  | "provenance"
  | "attestation";

/** Un destino de la release: sistema, arquitectura y formato. */
export interface IReleaseTarget {
  readonly os: ReleaseOs;
  readonly arch: ReleaseArch;
  readonly bundle: ReleaseBundle;
}

/** La firma de un artefacto, o de un asset firmado. */
export interface IReleaseSignature {
  /** De dónde sale la firma. */
  readonly kind: ReleaseSignatureKind;
  /**
   * Ruta relativa dentro del staging.
   *
   * Para `codesign` y `authenticode` es el propio artefacto (la firma
   * va embebida); para `gpg-detached` es el fichero `.sig`.
   */
  readonly path: string;
  /** Quién firmó: el nombre del certificado, la identidad o el uid. */
  readonly signer: string;
  /** El identificador de la clave: team id, thumbprint o key id. */
  readonly keyId: string;
  /** Si la firma lleva timestamp de un TSA (RFC 3161). */
  readonly timestamped: boolean;
  /** Si pasó por `notarytool`. Sólo macOS. */
  readonly notarized?: boolean;
  /** Si el ticket de notarización quedó grapado dentro del artefacto. */
  readonly stapled?: boolean;
  /**
   * El recibo que produjo la firma, relativo al staging.
   *
   * El recibo es lo que ata la firma a los bytes exactos que se
   * publicaron: lleva el digest del artefacto en el momento de firmarlo.
   * Si el artefacto cambia después, el digest ya no cuadra y la
   * verificación lo nota sin depender de la herramienta de cada
   * plataforma.
   */
  readonly receipt: string | null;
}

/** Un artefacto final de la release: un instalador y su identidad. */
export interface IReleaseArtifact {
  /** Versión semver que dice contener. */
  readonly version: string;
  readonly os: ReleaseOs;
  readonly arch: ReleaseArch;
  readonly bundle: ReleaseBundle;
  /** Ruta relativa dentro del staging. */
  readonly path: string;
  /** SHA-256 en hexadecimal minúsculas, recalculado sobre el fichero. */
  readonly sha256: string;
  /**
   * La firma, o `null` si el artefacto no está firmado.
   *
   * `null` es un estado legítimo del manifest —el de un build de
   * desarrollo— pero **no** de una publicación: el verificador falla
   * cerrado ante un artefacto sin firma, y por eso el tipo lo permite
   * en vez de esconder el caso con un objeto vacío.
   */
  readonly signature: IReleaseSignature | null;
  /** Referencia al SBOM que cubre este artefacto, si lo hay. */
  readonly sbom: IReleaseAssetRef | null;
  /** Referencia al attestation de provenance, si lo hay. */
  readonly provenance: IReleaseAssetRef | null;
}

/** Un asset de la release que no es un instalador. */
export interface IReleaseAsset {
  readonly kind: ReleaseAssetKind;
  /** Ruta relativa dentro del staging. */
  readonly path: string;
  /** SHA-256 en hexadecimal minúsculas, recalculado sobre el fichero. */
  readonly sha256: string;
  /** Firma del asset, si la tiene. `SHA256SUMS` va firmado. */
  readonly signature: IReleaseSignature | null;
}

/** Una referencia a un asset: ruta y digest, sin repetir el fichero. */
export interface IReleaseAssetRef {
  readonly path: string;
  readonly sha256: string;
}

/**
 * El manifest efímero de la release.
 *
 * Lo escribe `scripts/release/prepare-artifacts.mjs` sobre el staging
 * real, y lo vuelve a leer `scripts/release/verify-signature.sh` para
 * recalcular **todo** desde los ficheros. Un manifest que no cuadra
 * con los assets es un fallo, no un aviso.
 */
export interface IReleaseManifest {
  /** Discriminante de formato. Cambia si cambia la forma del manifest. */
  readonly schema: string;
  /** Versión semver de la release. */
  readonly version: string;
  /** ISO-8601 de cuándo se generó. */
  readonly generatedAt: string;
  /** Los instaladores, con su firma. */
  readonly artifacts: readonly IReleaseArtifact[];
  /** Los assets que acompañan a la release. */
  readonly assets: readonly IReleaseAsset[];
}

/**
 * Un proveedor de credenciales de firma.
 *
 * Se declara **por nombre de variable**, nunca por valor: el valor
 * vive en el almacén de secretos del CI y no tiene por qué existir en
 * el repositorio. Auditar qué falta es una operación sobre nombres.
 */
export interface ISigningProviderSpec {
  /** Identificador corto del proveedor. */
  readonly id: string;
  /** A qué plataforma sirve. */
  readonly os: ReleaseOs;
  /** Variables sin las cuales no se puede firmar en esta plataforma. */
  readonly requiredEnv: readonly string[];
  /** Variables que ajustan el comportamiento pero no son imprescindible. */
  readonly optionalEnv: readonly string[];
}

/**
 * El resultado de auditar las credenciales de un proveedor.
 *
 * `missing` y `present` llevan **nombres**, nunca valores. Un error
 * que imprimiese el valor de una credencial acabaría en el log de CI,
 * que es un sitio público.
 */
export interface ICredentialAudit {
  /** Si el proveedor puede firmar con lo que hay. */
  readonly ok: boolean;
  /** El proveedor auditado. */
  readonly provider: string;
  /** Variables que faltan, por nombre. */
  readonly missing: readonly string[];
  /** Variables que están, por nombre. */
  readonly present: readonly string[];
}

/** La política de firma de la release, tal y como la pide la config. */
export interface IReleaseSignConfig {
  /**
   * Si se firma.
   *
   * Por defecto `false`: el desarrollo local no tiene certificados y
   * no los necesita. Con `true`, la publicación pasa a exigir
   * credenciales **y** firmas verificadas.
   */
  readonly sign: boolean;
  /** Los destinos que esta política cubre. */
  readonly targets: readonly IReleaseTarget[];
}
