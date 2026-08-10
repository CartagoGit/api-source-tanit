/**
 * Lo que devuelve escanear un proyecto: el veredicto del discovery.
 *
 * Vive aquí y no dentro de `scan.script.ts` porque lo consumen dos
 * mundos que no deberían conocerse: el comando que lo produce y el tool
 * MCP que lo expone. Con el tipo pegado al script, el plugin tenía que
 * importar el comando entero —con su registro de scanners detrás— solo
 * para saber la forma del dato.
 *
 * Es el paso **anterior** a `IProjectSummary`: esto es lo que el
 * discovery ve en crudo, aquello es el proyecto ya interpretado. Cuando
 * las dos cifras no cuadran, la diferencia está justo en medio.
 */

/** Una ruta descubierta por el scanner, antes de convertirse en request. */
export interface IScannedRoute {
  readonly method: string;
  readonly uri: string;
  readonly tags: ReadonlyArray<string>;
  /** `null` cuando el framework no aporta descripción para esa ruta. */
  readonly description: string | null;
}

/** El resultado completo de un escaneo. */
export interface IScanOutcome {
  readonly code: number;
  /** La raíz que se acabó escaneando, ya resuelta. */
  readonly root: string;
  /** `null` si no se reconoció ningún framework. */
  readonly framework: string | null;
  /**
   * Los ficheros que delataron al framework: `package.json`, `server.js`…
   *
   * Es el «por qué» de la detección. Sin ellos, un framework mal
   * detectado es indistinguible de uno bien detectado.
   */
  readonly artifacts: ReadonlyArray<string>;
  /** Nombre de la clase que recorre las rutas, o `null` si no hay. */
  readonly scanner: string | null;
  /** Nombre del proveedor de reglas de validación, o `null`. */
  readonly validation: string | null;
  readonly routes: ReadonlyArray<IScannedRoute>;
}
