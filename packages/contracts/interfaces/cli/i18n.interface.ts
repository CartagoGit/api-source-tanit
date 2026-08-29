/**
 * Lo que la interfaz necesita para hablar un idioma.
 *
 * Un catálogo es un mapa plano de clave a texto. Plano y no anidado a
 * propósito: `ajustes.idioma.titulo` como **clave literal** se busca en
 * un fichero con un `Ctrl+F`, mientras que un objeto anidado obliga a
 * recorrer tres niveles para saber si una clave existe — y eso es lo
 * que hace que las traducciones se queden a medias sin que nadie lo
 * note.
 */

/** Un catálogo de traducciones: clave → texto en ese idioma. */
export type ITranslations = Readonly<Record<string, string>>;

/** Un idioma cargado y listo para usar. */
export interface ILoadedLocale {
  readonly code: string;
  /** Cómo se llama en su propio idioma, para el selector. */
  readonly nativeName: string;
  /** Se escribe de derecha a izquierda. */
  readonly rtl: boolean;
  readonly translations: ITranslations;
  /**
   * De dónde salió.
   *
   * `bundled` viene dentro del programa; `external` lo dejó alguien en
   * la carpeta de idiomas. La distinción no es informativa: un idioma
   * externo con el mismo código que uno empaquetado **gana**, y quien
   * lo puso tiene que poder confirmar que su fichero es el que manda.
   */
  readonly origin: "bundled" | "external";
}

/** El catálogo entero, ya resuelto. */
export interface II18nCatalog {
  /** Los idiomas disponibles, para pintar el selector. */
  readonly locales: ReadonlyArray<ILoadedLocale>;
  /**
   * Los ficheros externos que **no** se pudieron cargar, con su motivo.
   *
   * Van aquí y no a un `throw`: un idioma roto que alguien dejó en su
   * carpeta no puede impedir que la interfaz arranque. Pero tampoco
   * puede desaparecer en silencio, porque entonces quien lo escribió no
   * tiene forma de saber por qué su idioma no sale en la lista.
   */
  readonly rejected: ReadonlyArray<{ readonly file: string; readonly reason: string }>;
}
