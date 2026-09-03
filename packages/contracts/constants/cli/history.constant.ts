/**
 * Constantes del historial de generaciones.
 *
 * Lo que aquí vive es invariante: nombre del fichero, permisos de la
 * carpeta, número de versión de cada entrada. Cambiarlo **mueve** el
 * historial —el fichero pasa a tener otro nombre, los lectores viejos
 * no entienden la versión nueva— y por eso son constantes y no
 * parámetros configurables: si alguien quiere su propia ruta, que use
 * otra carpeta.
 */

/**
 * Permiso a usar cuando hace falta crear la carpeta del historial.
 *
 * `0o755` en Unix: el dueño puede escribir y los demás solo leer. Es lo
 * razonable para un log que solo escribe el programa que corre como
 * ese usuario, y que nadie más necesita modificar.
 */
export const HISTORY_DIR_MODE = 0o755;

/**
 * Versión de la forma de cada entrada del historial.
 *
 * Sube si se cambia un campo o se reordena la serialización. El
 * número va en cada línea JSONL —es lo primero que un futuro parser
 * mira— y permite ignorar entradas antiguas si la forma cambia de
 * manera incompatible.
 */
export const HISTORY_ENTRY_VERSION = 1;

/**
 * Nombre del fichero de historial dentro del directorio del usuario.
 *
 * `.jsonl` y no `.json` a propósito: cada generación añade una línea,
 * y dos escrituras concurrentes —la interfaz y un `watch`, por
 * ejemplo— no deben competir por reescribir el fichero entero. JSONL
 * permite append atómico por líneas.
 */
export const HISTORY_FILE_NAME = "history.jsonl";

/**
 * Nombre de la carpeta del historial, oculta en Unix.
 *
 * Separada de la carpeta de configuración (que es `expostman`, sin
 * punto, y vive bajo `~/.config/` o similar) porque su propósito es
 * otro: la primera guarda ajustes e idiomas que el usuario modifica a
 * mano; la segunda guarda el log que la herramienta escribe sola.
 */
export const HISTORY_DIR_NAME = ".expostman";
