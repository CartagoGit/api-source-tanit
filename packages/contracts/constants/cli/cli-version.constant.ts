/**
 * La versión del CLI.
 *
 * Vive en contratos porque la necesitan **dos** sitios que no
 * comparten código: el propio CLI, que la imprime cuando alguien
 * pregunta (`apisrc --version`), y el smoke del updater, que la
 * compara con la versión que se está instalando para poder afirmar
 * que la app y su sidecar son la misma versión.
 *
 * ## Por qué no se lee el `package.json` en caliente
 *
 * Porque el binario compilado (`bun build --compile`) no tiene un
 * `package.json` al lado: leerlo en caliente funcionaría desde el
 * código fuente y fallaría en el binario que se distribuye, que es
 * justo donde importa. Una constante es la misma en los dos casos.
 *
 * ## Cómo se evita que se quede vieja
 *
 * `tests/cli/cli-version.spec.ts` compara esta constante con la
 * versión del `package.json` raíz. Si alguien sube la versión del
 * paquete y no actualiza esta constante, el test falla.
 */

/** La versión del CLI, la misma que la del paquete publicado. */
export const CLI_VERSION = "1.0.0";
