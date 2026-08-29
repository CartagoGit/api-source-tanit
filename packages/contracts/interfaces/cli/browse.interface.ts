/**
 * Navegar carpetas desde la interfaz.
 *
 * Lo que viaja son **nombres de directorio**, nunca contenido de
 * ficheros. No es una simplificación: un endpoint que devolviera
 * contenido sería un lector de ficheros arbitrario corriendo en la
 * máquina de alguien, y da igual que escuche solo en `127.0.0.1` — esta
 * misma interfaz ya tuvo un CSRF por dar por bueno ese razonamiento.
 */

/** Una carpeta de la lista. */
export interface IBrowseEntry {
  /** El nombre a secas, para pintar. */
  readonly name: string;
  /** La ruta absoluta, que es lo que se elige. */
  readonly path: string;
  /**
   * Si se puede entrar.
   *
   * Una carpeta sin permiso, o un enlace roto, sale marcada en vez de
   * desaparecer: verla y no poder entrar se entiende; que no aparezca
   * parece que el explorador está fallando.
   */
  readonly readable: boolean;
}

/** Lo que devuelve listar una carpeta. */
export interface IBrowseListing {
  readonly ok: boolean;
  /** La carpeta que se ha listado, ya resuelta a absoluta. */
  readonly path: string;
  /** La de encima, o `null` si esto ya es la raíz. */
  readonly parent: string | null;
  readonly entries: ReadonlyArray<IBrowseEntry>;
  /**
   * Si la lista se ha cortado.
   *
   * Va aparte del motivo porque es una condición, no un mensaje: la
   * interfaz necesita saberlo para enseñar un aviso, y leer prosa para
   * decidir eso es lo que hace que se rompa al traducirla.
   */
  readonly truncated: boolean;
  /** Por qué falló, o por qué se cortó. `undefined` cuando todo fue bien. */
  readonly reason?: string;
}
