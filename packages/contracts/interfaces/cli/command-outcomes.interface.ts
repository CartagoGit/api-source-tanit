/**
 * Lo que devuelve cada comando del CLI, en datos.
 *
 * Cada comando expone un `run*()` que devuelve su `Outcome` y un `main()`
 * que lo pinta. Esa separación existe porque **el plugin MCP necesita los
 * datos**: parsear la tabla que imprime el CLI con expresiones regulares
 * se rompe el día que cambia una columna, y ese hack ya se pagó aquí.
 *
 * Los `Outcome` viven en contratos y no dentro de cada script por lo
 * mismo: los consumen dos mundos que no deberían conocerse —el comando
 * que los produce y el tool que los expone—, y con el tipo pegado al
 * script el plugin tenía que importar el comando entero, con su registro
 * de scanners detrás, solo para saber la forma del dato.
 */

import type { IGenerateReport } from "../core/generate-report.interface.js";

/** Un endpoint de la colección, en datos. */
export interface IListedEndpoint {
  readonly method: string;
  readonly uri: string;
  readonly name: string;
  readonly folder: string;
  readonly zone: string;
}

/** Lo que devuelve listar: código de salida y los endpoints. */
export interface IListOutcome {
  readonly code: number;
  readonly endpoints: ReadonlyArray<IListedEndpoint>;
}

/** Un endpoint que está en un lado y no en el otro. */
export interface IDriftedEndpoint {
  readonly method: string;
  readonly uri: string;
  readonly name?: string | undefined;
}

/**
 * La deriva entre el código y la colección, en datos.
 *
 * Se devuelve además de imprimirse porque el CLI no es el único
 * consumidor: el tool `check` del plugin necesita **los endpoints**, no
 * la tabla. Parsear la salida por pantalla con regex es lo que se hacía
 * antes en otro tool del plugin, y se rompe el día que cambia una
 * columna.
 */
export interface ICheckReport {
  readonly inSync: boolean;
  readonly routesInSource: number;
  readonly requestsInCollection: number;
  readonly missingInCollection: ReadonlyArray<IDriftedEndpoint>;
  readonly missingInSource: ReadonlyArray<IDriftedEndpoint>;
}

/** Lo que devuelve comprobar: código de salida e informe. */
export interface ICheckOutcome {
  readonly code: number;
  readonly report: ICheckReport | null;
}

/**
 * Lo que devuelve una generación: el código de salida y el informe.
 *
 * El informe se construye **siempre**, no solo con `--json`. Antes solo
 * existía dentro de ese `if`, así que cualquier otro consumidor
 * —`apisrc ui`, un test, el plugin— tenía que volver a llamar al
 * pipeline o parsear la salida por pantalla. Las dos cosas son una
 * segunda implementación, y una segunda implementación se
 * desincroniza.
 */
export interface IGenerateOutcome {
  readonly code: number;
  readonly report: IGenerateReport | null;
}
