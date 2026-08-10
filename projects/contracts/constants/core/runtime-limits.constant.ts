/**
 * Los números y nombres fijos que gobiernan la ejecución.
 *
 * Cada uno lo lee más de un sitio, que es lo que los hace contrato y no
 * detalle interno: el que ajusta el valor y el que lo comprueba en un
 * test no pueden tener cada uno el suyo.
 */

/**
 * Cuántos ficheros se leen a la vez al escanear.
 *
 * Ni uno (lento sin motivo) ni sin límite (un proyecto grande abre miles
 * de descriptores y el sistema empieza a rechazar). Dieciséis es el
 * punto medido donde deja de mejorar.
 */
export const READ_CONCURRENCY = 16;

/**
 * Cuánto espera `watch` antes de regenerar tras un cambio.
 *
 * Un guardado en un editor produce varios eventos seguidos; sin espera,
 * la colección se regenera tres veces por cada Ctrl+S.
 */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Variable que acota dónde puede escribir la salida.
 *
 * Vacía cuando lo lanza una persona: `--output-dir /donde/quiera` es un
 * uso legítimo. La pone **el plugin MCP** al invocar el CLI, porque ahí
 * quien elige la ruta es un agente y un `../` escribiría fuera del
 * proyecto.
 *
 * El nombre lo comparten quien la escribe (el plugin) y quien la lee
 * (`ensureOutputDir`), así que vive donde los dos lo ven.
 */
export const CONTAINMENT_ROOT_VAR = "POSTMAN_CONTAIN_ROOT";
