/**
 * Lo que devuelve preparar la configuración de un proyecto.
 *
 * `init` **escribe dentro del proyecto anfitrión**, así que lo que
 * devuelve tiene que decir exactamente qué se ha tocado. Un agente que
 * lo invoque necesita poder enseñar las dos rutas y lo que se detectó,
 * porque el siguiente paso es que alguien edite esos ficheros a mano:
 * están llenos de `// TODO` a propósito.
 */

/** El resultado completo de un `init`. */
export interface IInitOutcome {
  readonly code: number;
  /** Nombre deducido del manifiesto del ecosistema. */
  readonly projectName: string;
  /** URL base sacada del `.env`, o la de por defecto. */
  readonly baseUrl: string;
  /**
   * Guards de autenticación detectados en el middleware.
   *
   * `["token"]` cuando no se reconoce ninguno: no es que no haya auth,
   * es que no se ha podido deducir cuál.
   */
  readonly authGuards: ReadonlyArray<string>;
  /** Ficheros de rutas encontrados, con el prefijo que se les aplica. */
  readonly routeFiles: ReadonlyArray<string>;
  /** Ruta absoluta del `config.constant.ts` escrito. */
  readonly configPath: string | null;
  /** Ruta absoluta del `endpoints.constant.ts` escrito. */
  readonly endpointsPath: string | null;
  /** Por qué no se pudo, y qué hacer. `null` cuando fue bien. */
  readonly error: { readonly reason: string; readonly nextAction: string } | null;
}
