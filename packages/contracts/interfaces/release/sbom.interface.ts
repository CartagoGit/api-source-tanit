/**
 * El contrato del SBOM CycloneDX y de la attestation de provenance.
 *
 * Lo usan **tres** sitios que no comparten código: el script que
 * construye el SBOM (`scripts/release/build-sbom.mjs`), el que lo
 * verifica (`scripts/release/verify-sbom.mjs`) y el test que prueba los
 * dos (`tests/release/sbom.spec.ts`). Cuando cada uno inventa su propio
 * formato, la verificación deja de comprobar nada y pasa a comprobar que
 * los ficheros existen.
 *
 * ## Un SBOM no es un inventario
 *
 * Un inventario dice **qué hay**. Un SBOM dice **qué hay, de quién es y
 * con qué bytes**. Lo segundo es lo que permite auditar: sin el
 * `bom-ref` no hay grafo, sin el hash no hay identidad, y sin la
 * provenance no hay de dónde viene. Por eso el contrato tiene las tres
 * mitades y por eso la provenance se firma: un documento sin firmar es
 * una afirmación, y una afirmación no se puede auditar.
 *
 * ## Por qué el hash va con el componente y no aparte
 *
 * Porque un hash suelto es un hash de algo, y el "algo" tiene que estar
 * en el mismo documento. Separados, el hash puede hablar de un
 * componente que no es el que tiene el hash, y quien lee tiene que
 * casarlos a mano — que es exactamente el trabajo que el SBOM debería
 * haberte hecho.
 */

/**
 * Un tipo de componente de CycloneDX.
 *
 * La lista es la del formato. `library` es lo que lleva el grafo de
 * dependencias: crates, paquetes de npm y bibliotecas nativas.
 */
export type SbomComponentType =
  | "application"
  | "framework"
  | "library"
  | "container"
  | "operating-system"
  | "device"
  | "firmware"
  | "file";

/**
 * Un hash de un componente.
 *
 * `content` va en hexadecimal minúsculas, que es lo que exige CycloneDX
 * 1.6: el formato acepta base64 en versiones anteriores y en 1.6 ya no.
 */
export interface ISbomHash {
  /** El algoritmo: `SHA-256` o `SHA-512`. */
  readonly alg: "SHA-256" | "SHA-512";
  /** El digest, en hexadecimal minúsculas. */
  readonly content: string;
}

/** Una propiedad de un componente: un par nombre/valor. */
export interface ISbomProperty {
  readonly name: string;
  readonly value: string;
}

/**
 * Un componente del SBOM.
 *
 * `bom-ref` es la identidad estable del componente dentro del
 * documento: es lo que las aristas de `dependencies` apuntan, y es lo
 * que no puede cambiar entre dos regeneraciones del mismo SBOM. Para
 * las bibliotecas es el purl; para los ficheros del staging es
 * `file:<ruta>`.
 */
export interface ISbomComponent {
  readonly type: SbomComponentType;
  readonly name: string;
  readonly version: string;
  readonly "bom-ref": string;
  /** El purl del componente, cuando tiene uno. */
  readonly purl?: string;
  readonly hashes?: readonly ISbomHash[];
  readonly properties?: readonly ISbomProperty[];
  /** Los `bom-ref` de los que depende este componente. */
  readonly dependsOn?: readonly string[];
}

/**
 * UnProveedor del SBOM.
 *
 * Es una organización, no una persona: el `supplier` de un SBOM dice
 * quién es responsable del software, no quién lo escribió.
 */
export interface ISbomSupplier {
  readonly name: string;
  /** Las URLs del proveedor. CycloneDX 1.6 las declara como lista. */
  readonly url?: readonly string[];
}

/**
 * El sujeto de una provenance.
 *
 * Un sujeto es un artefacto con su digest. La lista de sujetos es lo
 * que ata la attestation a los bytes concretos que se publican.
 */
export interface IProvenanceSubject {
  readonly name: string;
  readonly digest: Readonly<Record<string, string>>;
}

/** Cómo se construyó el artefacto: el `buildDefinition` de SLSA. */
export interface IProvenanceBuildDefinition {
  /** El tipo de build: la URL del workflow que lo produjo. */
  readonly buildType: string;
  /** Los parámetros externos: el repositorio, la ref, el workflow. */
  readonly externalParameters: Readonly<Record<string, unknown>>;
  /** Los parámetros internos: la plataforma, la arquitectura. */
  readonly internalParameters: Readonly<Record<string, unknown>>;
  /** De dónde salió el código: el commit y el repo. */
  readonly resolvedDependencies: readonly IProvenanceSubject[];
}

/** Cómo se ejecutó el build: el `runDetails` de SLSA. */
export interface IProvenanceRunDetails {
  /** Quién construyó: el identificador del builder. */
  readonly builder: Readonly<{ id: string }>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * El predicado de la provenance SLSA.
 *
 * Es la parte que dice **de dónde viene** lo que se firma. Sin ella,
 * una attestation sólo dice "esto está firmado".
 */
export interface IProvenancePredicate {
  readonly buildDefinition: IProvenanceBuildDefinition;
  readonly runDetails: IProvenanceRunDetails;
}

/**
 * El statement in-toto completo.
 *
 * Es lo que va dentro del payload del envelope DSSE, en base64. El
 * `subject` es lo que ata la attestation a los bytes: si el digest de
 * un artefacto no está en la lista de sujetos, la attestation no va
 * de este artefacto.
 */
export interface IProvenanceStatement {
  readonly _type: "https://in-toto.io/Statement/v1";
  readonly subject: readonly IProvenanceSubject[];
  readonly predicateType: "https://slsa.dev/provenance/v1";
  readonly predicate: IProvenancePredicate;
}

/**
 * Una firma dentro de un envelope DSSE.
 *
 * `keyid` es lo que dice **quién** firmó: es el identificador de la
 * clave, y es lo que el verificador compara con el que espera. Una
 * firma sin `keyid` no dice quién firmó.
 */
export interface IDsseSignature {
  readonly keyid: string;
  /** La firma, en base64. */
  readonly sig: string;
}

/**
 * El envelope DSSE.
 *
 * Es el formato de la attestation de GitHub, línea a línea. El payload
 * va en base64 porque el PAE que se firma lleva los bytes en claro: la
 * firma es sobre el payload **descodificado**, no sobre el texto que
 * viaja.
 */
export interface IDsseEnvelope {
  readonly payloadType: string;
  /** El statement, en base64. */
  readonly payload: string;
  readonly signatures: readonly IDsseSignature[];
}

/**
 * El documento CycloneDX completo.
 *
 * Los campos de la primera lista son los que CycloneDX 1.6 exige; los
 * de la segunda son los que el verificador además comprueba. El
 * contrato no dice "opcional" para los que importan: si no están, el
 * documento no describe la release.
 */
export interface ISbomDocument {
  readonly bomFormat: "CycloneDX";
  readonly specVersion: "1.6";
  /** El identificador único del documento: `urn:uuid:…`. */
  readonly serialNumber: string;
  /** La versión del **documento**, no la del producto. */
  readonly version: number;
  readonly metadata: Readonly<{
    /** ISO-8601 de cuándo se generó. */
    readonly timestamp: string;
    readonly lifecycles: readonly Readonly<{ phase: string }>[];
    readonly tools: Readonly<{
      readonly components: readonly Readonly<{
        readonly type: "application";
        readonly name: string;
        readonly version: string;
      }>[];
    }>;
    /** El componente raíz: de qué va este documento. */
    readonly component: ISbomComponent;
    /** El proveedor, cuando se sabe quién es. */
    readonly supplier?: ISbomSupplier;
  }>;
  readonly components: readonly ISbomComponent[];
  /** El grafo: quién depende de quién. */
  readonly dependencies: readonly Readonly<{
    readonly ref: string;
    readonly dependsOn: readonly string[];
  }>[];
}
