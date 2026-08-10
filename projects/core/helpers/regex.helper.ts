/**
 * Regex compartidos usados sin pisarse.
 *
 * Un regex con bandera `g` guarda su posición en `lastIndex`. Si vive a
 * nivel de módulo —que es lo normal, para no recompilarlo en cada
 * llamada— esa posición la comparte **todo el que lo use**.
 *
 * `lint:regex-state` ya prohibía asignarle una posición arbitraria,
 * porque eso cuelga el bucle de quien llamó. Pero permitía
 * `RE.lastIndex = 0`, que parecía inofensivo: deja el estado en un punto
 * conocido en vez de heredarlo.
 *
 * No lo es en cuanto hay dos análisis a la vez. El bucle
 *
 *     RE.lastIndex = 0;
 *     while ((m = RE.exec(line)) !== null) { await algo(); }
 *
 * cede el control en cada `await`. Si otra ejecución entra ahí y hace su
 * propio `RE.lastIndex = 0`, el bucle de la primera vuelve al principio
 * de la línea y repite rutas.
 *
 * Se midió sobre el fixture de Django: dos `generateCollection`
 * concurrentes sobre el **mismo** proyecto devolvían 19 y 18 rutas. La
 * de más se fusionaba luego por método + URI, así que la colección salía
 * bien y solo mentía el contador —y un aviso decía que el endpoint
 * estaba «declarado por más de un framework» cuando solo había uno—.
 *
 * Hasta ahora nadie lo veía porque el pipeline serializaba las llamadas
 * con una cola global. Al quitarla (r00005 S2), quedó a la vista.
 *
 * ## Qué usar
 *
 * - Para recorrer todas las coincidencias: `texto.matchAll(RE)`. No toca
 *   el `lastIndex` del original — se lleva su propia copia—, así que es
 *   seguro sin ayuda de nadie.
 * - Para un `exec` suelto con grupos: `ownRegex(RE)`, que es lo que
 *   `matchAll` hace por dentro.
 */

/**
 * Una copia propia de un regex compartido.
 *
 * Nace con `lastIndex` a cero y nadie más la toca, así que se puede usar
 * con `exec` sin coordinarse con el resto del proceso.
 */
export function ownRegex(shared: RegExp): RegExp {
  return new RegExp(shared.source, shared.flags);
}
