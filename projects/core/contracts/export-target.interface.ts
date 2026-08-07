/**
 * El contrato de un formato de salida.
 *
 * El escaneo ya produce una representación intermedia —`EndpointSpec[]`
 * más la configuración del proyecto— que no sabe nada de Postman. Todo
 * lo que hace `collection-builder` es serializar eso a un formato
 * concreto. Un exportador es exactamente lo mismo para otro formato, y
 * por eso añadir uno **no toca el motor de escaneo**.
 *
 * Un exportador devuelve una lista de artefactos, no una cadena. Bruno
 * no es un fichero: es un árbol de carpetas con un `.bru` por request, y
 * un contrato que devolviera `string` habría dejado fuera el único
 * formato del lote que es Git-friendly, que es justo su gracia.
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ProjectConfig } from "./project-config.interface.js";

/** Un fichero a escribir, con su ruta relativa al directorio de salida. */
export interface IExportArtifact {
  /** Ruta relativa. Puede llevar carpetas: `mi-api/users/list.bru`. */
  readonly path: string;
  readonly content: string;
}

/** Todo lo que un exportador necesita saber del proyecto. */
export interface IExportInput {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly config: ProjectConfig;
  /**
   * Esquema de autenticación ya detectado.
   *
   * Se pasa hecho en vez de dejar que cada exportador lo deduzca: cinco
   * detecciones paralelas acabarían discrepando, y entonces el mismo
   * proyecto diría bearer en Postman y nada en Insomnia.
   */
  readonly auth: IExportAuth;
}

/** Lo que un exportador necesita del esquema de auth. */
export interface IExportAuth {
  readonly type: "bearer" | "apikey" | "oauth2" | "none";
  readonly keyName?: string | undefined;
  readonly keyIn?: "header" | "query" | undefined;
}

/**
 * Un formato de salida.
 *
 * Implementarlo y registrarlo en `export-registry.service.ts` es todo lo
 * que hace falta para añadir un formato: el motor de escaneo no se toca,
 * porque lo que se serializa es la representación intermedia que ya
 * produce.
 */
export interface IExportTarget {
  /** Identificador para `--format`. En minúsculas, sin espacios. */
  readonly format: string;
  /** Una línea para la ayuda del CLI. */
  readonly summary: string;
  /**
   * Serializa el proyecto a los ficheros de este formato.
   *
   * Es **síncrono y puro**: no toca el disco ni la red. Escribir es
   * trabajo de quien llama, y así un exportador se prueba comparando
   * cadenas en vez de montando un sistema de ficheros.
   */
  serialize(input: IExportInput): IExportArtifact[];
}
