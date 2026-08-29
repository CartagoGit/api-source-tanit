/**
 * Lo que devuelve subir la colección a Postman.
 *
 * Aquí hay una regla que no está en los otros `Outcome`: **la clave de
 * API no aparece**. Ni el valor, ni una versión enmascarada, ni el
 * nombre de la variable de la que salió.
 *
 * No es celo abstracto. `push` es el único comando que maneja un
 * secreto, y es justo el que un agente va a invocar por su cuenta: lo
 * que devuelva acaba en un historial de conversación, en un log del
 * host, o repetido de vuelta por el modelo. Un `detail` de la API de
 * Postman que incluyera la petición completa filtraría la clave sin que
 * nadie lo hubiera decidido.
 *
 * Por eso el error viaja como `{ reason, nextAction }` redactados aquí,
 * y no como el cuerpo crudo de la respuesta.
 */

/** Un artefacto que ha llegado a Postman. */
export interface IPushedArtifact {
  /** `"created"` si no existía, `"updated"` si se sobrescribió. */
  readonly action: "created" | "updated";
  /** UID que asigna Postman (`<userId>-<uuid>`). */
  readonly uid: string;
  readonly name: string;
}

/** Por qué no se pudo subir, y qué hacer. */
export interface IPushFailure {
  readonly reason: string;
  readonly nextAction: string;
}

/** El resultado completo de un `push`. */
export interface IPushOutcome {
  readonly code: number;
  /**
   * Usuario de Postman con el que se ha autenticado.
   *
   * Solo el nombre visible. Es lo que permite a quien lo lee darse
   * cuenta de que ha subido al workspace equivocado, que es el error
   * caro de este comando.
   */
  readonly user: string | null;
  /** `null` si no se reconoció ningún framework. */
  readonly framework: string | null;
  /** Requests que se han subido. */
  readonly requests: number;
  /** La colección, o `null` si no se llegó a subir. */
  readonly collection: IPushedArtifact | null;
  /** Un elemento por entorno subido. Vacío con `--no-environments`. */
  readonly environments: ReadonlyArray<IPushedArtifact>;
  /** `null` cuando todo fue bien. */
  readonly error: IPushFailure | null;
}
