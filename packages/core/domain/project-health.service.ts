/**
 * Salud de la documentación de un proyecto: porcentajes por categoría.
 *
 * La pregunta que responde no es "¿cuántos endpoints hay?" —eso ya lo
 * dicen `routesInCode` y compañía— sino "¿cómo están de bien documentados?"
 * Un resumen que no la contesta obliga a quien inspecciona a contar a
 * mano cuántas rutas llevan body o descripción.
 *
 * Es una función **pura**: consume los specs finales del pipeline —los
 * mismos que alimentan la colección— y devuelve porcentajes. Nada de
 * disco, nada de heurísticas nuevas: cada categoría se mide sobre una
 * pieza que el spec ya lleva, así que lo que dice el health es lo que
 * `generate` produce.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { IProjectHealth } from "../../contracts/interfaces/core/domain.interface.js";

/**
 * Computa la salud del proyecto a partir de los specs finales.
 *
 * Con cero endpoints, todos los porcentajes son `0`: no hay nada que
 * documentar y un `NaN` o un 100 sin rutas serían las dos mentiras
 * posibles. Con rutas, cada porcentaje es el cociente de endpoints que
 * llevan la pieza, redondeado a entero para que el CLI y el tool MCP
 * lo muestren tal cual.
 *
 * El body cuenta si el spec lleva uno —de reglas resueltas o de la
 * inferencia agnóstica, que ya corrió antes de aquí—. Los ejemplos
 * cuentan cuando el body lleva algún valor o hay params con valor;
 * son las dos vías por las que la colección enseña **un** valor válido
 * al usuario.
 */
export function computeProjectHealth(
  specs: ReadonlyArray<EndpointSpec>,
): IProjectHealth {
  const total = specs.length;
  if (total === 0) {
    return {
      withValidationPercent: 0,
      withBodySchemaPercent: 0,
      withExamplesPercent: 0,
      withDescriptionPercent: 0,
    };
  }

  const withValidation = specs.filter((s) => s.formRequest != null).length;
  const withBodySchema = specs.filter(hasBodyContent).length;
  const withExamples = specs.filter(hasExampleValues).length;
  const withDescription = specs.filter((s) => hasText(s.description)).length;

  return {
    withValidationPercent: percent(withValidation, total),
    withBodySchemaPercent: percent(withBodySchema, total),
    withExamplesPercent: percent(withExamples, total),
    withDescriptionPercent: percent(withDescription, total),
  };
}

/**
 * El body "cuenta" cuando trae contenido real.
 *
 * Un `body: {}` vacío llega de las reglas cuyo ejemplo no pudo
 * construirse; contarlo como documentado sería inflar la nota con un
 * hueco. El objeto vacío también es el `body` por defecto de los specs
 * manuales sin overrides, así que la exclusión cubre los dos.
 */
function hasBodyContent(spec: EndpointSpec): boolean {
  return (
    spec.body != null &&
    typeof spec.body === "object" &&
    !Array.isArray(spec.body) &&
    Object.keys(spec.body).length > 0
  );
}

/**
 * Hay ejemplos cuando el body lleva algún valor o algún param lo lleva.
 *
 * Son las dos vías por las que la colección enseña **un** valor válido:
 * el body de ejemplo para lo que se manda, y query/headers con valor
 * para lo que viaja en la URL o en cabeceras.
 */
function hasExampleValues(spec: EndpointSpec): boolean {
  if (hasBodyContent(spec)) return true;
  const queryWithValue = spec.query?.some((q) => q.value !== "") ?? false;
  return queryWithValue;
}

function hasText(text: string | undefined): boolean {
  return text != null && text.trim() !== "";
}

/** Cociente en porcentaje entero, redondeado. `0..100` garantizado. */
function percent(part: number, total: number): number {
  return Math.round((part / total) * 100);
}
