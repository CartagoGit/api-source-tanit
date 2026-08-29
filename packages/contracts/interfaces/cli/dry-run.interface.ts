/**
 * El ensayo: qué pasaría si se generara.
 *
 * La forma de esta respuesta está pensada para una pantalla, no para un
 * log. Por eso `overwrites` es un número aparte y no algo que el
 * consumidor deba derivar contando: es **el** dato del ensayo —la
 * primera vez todo es nuevo, y a partir de la segunda lo interesante es
 * qué se pierde— y dejar que cada pantalla lo cuente por su cuenta es
 * cómo dos acaban diciendo cifras distintas de lo mismo.
 */

import type { IGenerationResult } from "../core/discovery.interface.js";

/** Un fichero que se escribiría. */
export interface IPlannedFile {
  /** Ruta absoluta, tal cual se escribiría. */
  readonly path: string;
  /**
   * Qué es.
   *
   * `collection` es la de Postman; `export` es la misma API en otro
   * formato; `environment` son las variables por entorno. Se distinguen
   * porque no se pierden igual: sobrescribir un environment editado a
   * mano borra credenciales que alguien puso.
   */
  readonly kind: "collection" | "export" | "environment";
  /** El formato del que sale. */
  readonly format: string;
  /** Si ya hay un fichero ahí que se perdería. */
  readonly overwrites: boolean;
}

/** Lo que hace falta para planificar sin escribir. */
export interface IDryRunInput {
  readonly projectRoot: string;
  /** Dónde iría la salida. Por defecto, la carpeta convencional. */
  readonly outputDir?: string | undefined;
  /** Los formatos pedidos. Por defecto, solo Postman. */
  readonly formats?: ReadonlyArray<string> | undefined;
  /**
   * El resultado del pipeline, **ya construido en memoria**.
   *
   * Se pasa hecho en vez de calcularlo aquí porque el ensayo no puede
   * tener su propia forma de descubrir endpoints: sería una segunda
   * implementación que acabaría diciendo una cosa mientras `generate`
   * hace otra, que es el fallo que un ensayo viene a evitar.
   */
  readonly result: IGenerationResult;
}

/** El plan completo, sin haber tocado el disco. */
export interface IDryRunPlan {
  readonly ok: boolean;
  /** Dónde iría todo. */
  readonly outputDir: string;
  /** El nombre del que salen los ficheros. */
  readonly projectName: string;
  readonly framework: string | null;
  /** Cuántas requests tendría la colección. */
  readonly requests: number;
  readonly files: ReadonlyArray<IPlannedFile>;
  /** Cuántos de esos ficheros ya existen. Es el dato que importa. */
  readonly overwrites: number;
  /** Lo que el pipeline avisaría al generar de verdad. */
  readonly warnings: ReadonlyArray<string>;
  /** Por qué el plan no es válido. `undefined` cuando lo es. */
  readonly reason?: string;
}
