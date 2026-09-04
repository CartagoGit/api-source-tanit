/**
 * Las formas de dato que devuelven los helpers del núcleo.
 *
 * Casi todos son **resultados discriminados** (`{ ok: true, … } | { ok:
 * false, reason }`), y esa forma es lo que se comparte: quien consume un
 * helper necesita declarar qué recibe sin importar el helper entero.
 *
 * `CollectionRead` y `JsonRead` son el ejemplo de por qué existen. Los
 * dos distinguen «no se pudo» de «se pudo y salió esto», que era la
 * confusión concreta que tapaba errores: `JSON.parse("null")` devuelve
 * `null`, y un `catch` que también devuelve `null` hace que un fichero
 * corrupto y uno que legítimamente contiene `null` acaben iguales.
 */

import type { PostmanCollection } from "./postman.interface.js";

/** Lo que devuelve intentar leer la colección. */
export type CollectionRead =
  | { readonly ok: true; readonly collection: PostmanCollection }
  | { readonly ok: false; readonly reason: string; readonly nextAction: string };

/**
 * Lo que devuelve intentar parsear JSON.
 *
 * Distingue «no se pudo» de «parseó a `null`», que se confundían:
 * `JSON.parse("null")` devuelve `null`, y un `catch` que también deja
 * `null` hace que un fichero corrupto y uno que legítimamente contiene
 * `null` acaben iguales. Solo uno de los dos merece un aviso.
 */
export type JsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** Semilla de la colección de un proyecto. */
export interface ICollectionIdentity {
  /** ID fijado a mano por el host, si lo hay. Gana sobre todo lo demás. */
  readonly explicitId?: string | undefined;
  /** Nombre de la colección tal como se verá en Postman. */
  readonly collectionName?: string | undefined;
  /** Nombre corto del proyecto. */
  readonly projectName?: string | undefined;
  /** Framework detectado, para desempatar dos proyectos homónimos. */
  readonly framework?: string | undefined;
}

/** Un incumplimiento concreto, con su ruta dentro de la colección. */
export interface ICollectionIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/** Ajustes opcionales del recorrido. */
export interface ICollectFilesOptions {
  /**
   * Si `false`, no se saltan `node_modules`, `.git`, `vendor`… Por
   * defecto se saltan: escanear dependencias de terceros produce ruido
   * (y en el caso del lint de tools, infracciones ajenas).
   */
  readonly skipVendorDirs?: boolean;
}

/**
 * Parsear JSON ajeno sin que `any` se cuele en el resto del programa.
 *
 * Los scanners leen manifiestos y specs **de otra gente**: entrada no
 * controlada. El pa

/** Por qué se rechaza una ruta, para poder decirlo. */
export type ContainmentResult =
  | { readonly ok: true; readonly resolved: string }
  | { readonly ok: false; readonly resolved: string; readonly reason: string };

/** Una petición sacada de una colección ya construida, aplanada. */
export interface CollectionRequest {
  method: string;
  uri: string;
  name: string;
  folder: string;
}

/** Un fichero ya leído, con la ruta tal cual venía en la entrada. */
export interface IReadFile {
  /** Ruta absoluta, tal cual venía en la entrada. */
  readonly path: string;
  readonly text: string;
}

/** De dónde salió la raíz. */
export type RootOrigin = "flag" | "env" | "cwd";

/**
 * La raíz, y de dónde salió.
 *
 * `origin` no es información de depuración: es lo que permite avisar
 * cuando la raíz se ha **adivinado**. Sin él, un comando no puede
 * distinguir «me han dicho que use este directorio» de «no me han dicho
 * nada y he cogido el actual», que es la diferencia entre escanear el
 * proyecto correcto y escanear lo que hubiera debajo del `cd` anterior.
 */
export interface IResolvedRoot {
  readonly root: string;
  readonly origin: RootOrigin;
  /** `true` cuando la eligió alguien; `false` cuando se adivinó. */
  readonly explicit: boolean;
}

/** Lo inyectable, para poder probarlo sin tocar los globales. */
export interface IResolveRootOptions {
  readonly argv?: ReadonlyArray<string> | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly cwd?: string | undefined;
}

/** Lo que hace falta para identificar una operación. */
export interface IEndpointIdentity {
  /** Método HTTP en mayúsculas. */
  readonly method: string;
  /** URI, con o sin normalizar: aquí se normaliza igual. */
  readonly uri: string;
  /**
   * Nombre de la operación, cuando el protocolo lo necesita.
   *
   * En REST sobra: `GET /users` ya es único. En RPC sobre POST es **lo
   * único** que distingue una operación de otra, porque la URL es la
   * misma para todas.
   */
  readonly name?: string | undefined;
  /**
   * Cuerpo exacto, como último recurso.
   *
   * Dos requests al mismo endpoint con el mismo nombre pero distinto
   * cuerpo son dos variantes legítimas —el catálogo genera una por cada
   * combinación de reglas— y no deben contarse como duplicadas.
   */
  readonly body?: string | undefined;
  /**
   * Identidad del workspace / servicio al que pertenece la operación.
   *
   * Audit 2ª revisión #3: en un monorepo con múltiples workspaces
   * (apps/users-api, apps/payments-api), dos endpoints `GET /health`
   * de servicios DISTINTOS no son la misma operación y no deben
   * fusionarse en una sola. Antes, el merger agrupaba por
   * METHOD + URI y podía colapsar ambos en un único endpoint.
   * Ahora cada candidato lleva su `serviceId` (típicamente el
   * `frameworkSearchRoot` del match, o "" para proyectos planos) y
   * la clave de identidad incluye esa dimensión.
   *
   * Vacío (`""`) significa "proyecto plano, no hay workspaces que
   * separar". Mantener `""` como valor por defecto evita romper
   * proyectos no-monorepo donde `serviceId` no aplica.
   */
  readonly serviceId?: string;
}

/** Posición de una llamada balanceada: el `(` de apertura y su `)`. */
export interface IBalancedCall {
  /** Índice del `(` que abre la llamada. */
  readonly callStart: number;
  /** Índice del `)` que la cierra. */
  readonly callEnd: number;
}

/** Lo que el emisor de YAML sabe representar. */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | YamlValue[]
  | { [key: string]: YamlValue };
